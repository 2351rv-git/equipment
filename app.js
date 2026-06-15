// ==========================================================================
// 1. Firebase 구성 및 초기 데이터 정의
// ==========================================================================

// 실시간 동기화를 사용하려면 본인의 Firebase Realtime Database 구성값으로 설정하세요.
// 설정하지 않은 경우 브라우저의 LocalStorage를 활용한 로컬 모드로 자동 작동합니다.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 기본 의료기기 15개 목록
const DEFAULT_EQUIPMENT = [
  "환자감시모니터 (Patient Monitor)",
  "인공호흡기 (Ventilator)",
  "산소포화도측정기 (Pulse Oximeter)",
  "심전도기 (ECG)",
  "제세동기 (Defibrillator)",
  "수액펌프 (Infusion Pump)",
  "시린지펌프 (Syringe Pump)",
  "초음파진단기 (Ultrasound)",
  "인큐베이터 (Incubator)",
  "흡인기 (Suction Machine)",
  "네블라이저 (Nebulizer)",
  "이동형 X-Ray (Mobile X-Ray)",
  "혈압계 (BP Monitor)",
  "체온계 (Thermometer)",
  "황달측정기 (Bilirubin Meter)"
];

const DEFAULT_PAGE_ID = "page_default_1";
const ADMIN_PASSWORD = "1234";

// 애플리케이션 상태 (State)
let state = {
  theme: "light",
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1, // 1-indexed
  pages: [
    {
      id: DEFAULT_PAGE_ID,
      name: "페이지 1",
      department: "",
      inspector: "",
      equipment: sanitizeEquipmentList([])
    }
  ],
  // 구조: { '2026-6': { 'pageId': { 'equipIndex': { 'day': 'value' } } } }
  checklistData: {}
};

// 동기화 상태 제어 변수
let isCloudMode = false;
let dbRef = null;
let isFirstFirebaseLoad = true;
let holidaysCache = null;

// 현재 편집 중인 셀 정보
let activeCell = {
  pageId: null,
  equipIndex: null,
  day: null,
  element: null
};

// 현재 기기 편집 창(모달)에서 열고 있는 대상 페이지 ID
let activeModalPageId = null;

// 장비 목록 배열이 항상 정확히 15개의 요소(빈 문자열 포함)를 가지도록 보장하는 헬퍼
function sanitizeEquipmentList(equipmentArray) {
  const arr = [...(equipmentArray || [])];
  while (arr.length < 15) {
    arr.push("");
  }
  return arr.slice(0, 15);
}

// 관리자 인증 팝업
function checkAdminAccess() {
  const input = prompt("관리자 비밀번호를 입력해주세요 (기본: 1234):");
  if (input === ADMIN_PASSWORD) {
    return true;
  }
  alert("비밀번호가 일치하지 않습니다. 관리자 권한이 필요합니다.");
  return false;
}

// ==========================================================================
// 2. 동기화 모드 제어 및 로드/세이브 로직
// ==========================================================================

// Firebase 초기화 및 연동 검증
function initStorageMode() {
  const statusBadge = document.getElementById("sync-status");
  
  if (firebaseConfig.databaseURL && firebaseConfig.databaseURL !== "YOUR_DATABASE_URL") {
    try {
      firebase.initializeApp(firebaseConfig);
      dbRef = firebase.database().ref("medical_checklist");
      isCloudMode = true;
      
      statusBadge.className = "status-badge cloud";
      statusBadge.innerHTML = `<i data-lucide="cloud"></i> 실시간 클라우드 모드`;
      
      initFirebaseListeners();
    } catch (error) {
      console.error("Firebase 연결 실패. 로컬 모드로 전환합니다.", error);
      fallbackToLocalMode(statusBadge);
    }
  } else {
    fallbackToLocalMode(statusBadge);
  }
  lucide.createIcons();
}

function fallbackToLocalMode(statusBadge) {
  isCloudMode = false;
  statusBadge.className = "status-badge local";
  statusBadge.innerHTML = `<i data-lucide="database"></i> 로컬 저장 모드`;
  
  loadStateFromLocalStorage();
  initSelectors();
  renderAllPageSheets();
}

// Firebase 실시간 리스너 정의
function initFirebaseListeners() {
  dbRef.on("value", (snapshot) => {
    const data = snapshot.val();
    
    if (data) {
      // 클라우드 정보 반영
      state.pages = data.pages || state.pages;
      state.checklistData = data.checklistData || {};
      
      // 15칸 데이터 안전 보정
      state.pages.forEach(page => {
        page.equipment = sanitizeEquipmentList(page.equipment);
        if (page.department === undefined) page.department = "";
        if (page.inspector === undefined) page.inspector = "";
      });
      
      if (isFirstFirebaseLoad) {
        initSelectors();
        isFirstFirebaseLoad = false;
      } else {
        updateDropdowns();
      }
      renderAllPageSheets();
    } else {
      // Firebase에 데이터가 아예 없는 경우 초기 업로드 진행
      if (isFirstFirebaseLoad) {
        loadStateFromLocalStorage(); // 로컬 캐시 승계 시도
        dbRef.set({
          pages: state.pages,
          checklistData: state.checklistData
        });
        initSelectors();
        renderAllPageSheets();
        isFirstFirebaseLoad = false;
      }
    }
  });
}

// 로컬 저장소 백업 로드
function loadStateFromLocalStorage() {
  const savedState = localStorage.getItem("medical_equip_state_scroll_v1");
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      state = { ...state, ...parsed };
      
      state.pages.forEach(page => {
        page.equipment = sanitizeEquipmentList(page.equipment);
        if (page.department === undefined) page.department = "";
        if (page.inspector === undefined) page.inspector = "";
      });
    } catch (e) {
      console.error("로컬 스토리지 데이터를 불러오는 데 실패했습니다.", e);
    }
  }
}

// 상태 저장 (하이브리드 지원)
function saveStateToStorage() {
  // 항상 로컬에도 안전 캐시 백업
  localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
  
  if (isCloudMode && dbRef) {
    dbRef.child("pages").set(state.pages);
  }
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  lucide.createIcons();
}

// ==========================================================================
// 3. UI 렌더링 함수 - 다중 페이지 세로 연속 출력
// ==========================================================================

function initSelectors() {
  const yearSelect = document.getElementById("select-year");
  const monthSelect = document.getElementById("select-month");
  
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = "";
  for (let y = currentYear - 5; y <= currentYear + 5; y++) {
    const option = document.createElement("option");
    option.value = y;
    option.textContent = y;
    if (y === state.year) option.selected = true;
    yearSelect.appendChild(option);
  }
  
  monthSelect.innerHTML = "";
  for (let m = 1; m <= 12; m++) {
    const option = document.createElement("option");
    option.value = m;
    option.textContent = m;
    if (m === state.month) option.selected = true;
    monthSelect.appendChild(option);
  }

  updateDropdowns();
}

function updateDropdowns() {
  const quickSelect = document.getElementById("quick-page-select");
  const batchPageSelect = document.getElementById("batch-page-select");
  
  // 빠른 스크롤 바로가기
  quickSelect.innerHTML = '<option value="">페이지 선택 (스크롤 이동)...</option>';
  state.pages.forEach((page) => {
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = page.department || "구분 미입력";
    quickSelect.appendChild(option);
  });

  // 일괄 입력 대상
  const prevSelected = batchPageSelect.value;
  batchPageSelect.innerHTML = '<option value="">적용 대상 페이지 선택...</option>';
  state.pages.forEach((page, index) => {
    const option = document.createElement("option");
    option.value = page.id;
    option.textContent = page.department || "구분 미입력";
    // 이전 선택값을 복원하거나, 없으면 첫 번째 선택
    if (page.id === prevSelected || (index === 0 && !prevSelected)) {
      option.selected = true;
    }
    batchPageSelect.appendChild(option);
  });

  updateBatchEquipmentDropdown();
}

function updateBatchEquipmentDropdown() {
  const batchPageSelect = document.getElementById("batch-page-select");
  const daySelect = document.getElementById("batch-day-select");
  const equipSelect = document.getElementById("batch-equip-select");
  
  const targetPageId = batchPageSelect.value;
  const daysInMonth = getDaysInMonth(state.year, state.month);
  
  daySelect.innerHTML = '<option value="">일자 선택...</option>';
  for (let d = 1; d <= daysInMonth; d++) {
    const option = document.createElement("option");
    option.value = d;
    option.textContent = `${d}일`;
    daySelect.appendChild(option);
  }

  equipSelect.innerHTML = '<option value="">기기 선택...</option>';
  
  const page = state.pages.find(p => p.id === targetPageId);
  if (page && page.equipment) {
    page.equipment.forEach((name, index) => {
      const displayName = name.trim() ? name : `(미등록 슬롯 ${index + 1})`;
      const option = document.createElement("option");
      option.value = index;
      option.textContent = `${index + 1}. ${displayName.substring(0, 15)}${displayName.length > 15 ? '...' : ''}`;
      equipSelect.appendChild(option);
    });
  }
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getDayOfWeek(year, month, day) {
  return new Date(year, month - 1, day).getDay();
}

// 오픈 API를 통한 대한민국 공휴일 데이터 로드
async function fetchHolidays() {
  try {
    const response = await fetch("https://holidays.hyunbin.page/basic.json");
    if (response.ok) {
      holidaysCache = await response.json();
      console.log("공휴일 데이터를 성공적으로 로드했습니다.");
      renderAllPageSheets(); // 로드 완료 후 화면 재렌더링하여 공휴일 반영
    }
  } catch (error) {
    console.error("공휴일 데이터를 가져오는 데 실패했습니다. 기본 주말 및 고정 공휴일만 적용합니다.", error);
  }
}

// 특정 날짜의 공휴일 명칭 반환 (오픈 API 캐시 및 고정 법정공휴일 폴백)
function getHolidayName(year, month, day) {
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // 1. API 캐시에서 먼저 공휴일 확인
  if (holidaysCache) {
    const yearStr = String(year);
    if (holidaysCache[yearStr] && holidaysCache[yearStr][dateStr]) {
      return holidaysCache[yearStr][dateStr].join(", ");
    }
  }
  
  // 2. API 실패/미제공 시 고정 공휴일 및 근로자의 날 폴백 처리
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const fixedHolidays = {
    "01-01": "신정",
    "03-01": "삼일절",
    "05-01": "근로자의 날",
    "05-05": "어린이날",
    "06-06": "현충일",
    "08-15": "광복절",
    "10-03": "개천절",
    "10-09": "한글날",
    "12-25": "기독탄신일"
  };
  return fixedHolidays[mmdd] || "";
}

function renderAllPageSheets() {
  const container = document.getElementById("pages-container");
  
  // 현재 타이핑 중인 입력창 포커스 소실 방지를 위한 임시 추적
  const activeElementId = document.activeElement ? document.activeElement.id : null;
  const activePageId = document.activeElement ? document.activeElement.dataset.pageId : null;
  const cursorSelectionStart = document.activeElement ? document.activeElement.selectionStart : null;
  
  container.innerHTML = "";
  const daysInMonth = getDaysInMonth(state.year, state.month);
  const monthKey = `${state.year}-${state.month}`;
  
  const currentMonthData = state.checklistData[monthKey] || {};

  state.pages.forEach((page) => {
    const pageEquipments = sanitizeEquipmentList(page.equipment);
    
    const cardWrapper = document.createElement("section");
    cardWrapper.classList.add("page-card-wrapper");
    cardWrapper.id = `page-card-${page.id}`;
    
    // 1. 페이지 로컬 조작 헤더 바 (인쇄 시 자동 제외)
    const headerBar = document.createElement("div");
    headerBar.classList.add("page-header-bar", "no-print");
    headerBar.innerHTML = `
      <div class="page-dept-input-group">
        <label><i data-lucide="building" style="width: 14px; height: 14px;"></i> 구분(위치 및 분류):</label>
        <input type="text" class="page-dept-input" id="page-dept-input-${page.id}" data-page-id="${page.id}" value="${page.department || ''}" placeholder="">
      </div>
      <div class="page-inspector-input-group">
        <label><i data-lucide="user" style="width: 14px; height: 14px;"></i> 점검 담당자:</label>
        <input type="text" class="page-inspector-input" id="page-inspector-input-${page.id}" data-page-id="${page.id}" value="${page.inspector || ''}" placeholder="">
      </div>
      <div class="page-action-buttons">
        <button class="btn btn-xs btn-secondary edit-equip-btn" data-page-id="${page.id}">
          <i data-lucide="sliders" style="width: 12px; height: 12px;"></i> 기기 편집
        </button>
        <button class="btn btn-xs btn-danger-outline delete-page-btn" data-page-id="${page.id}">
          <i data-lucide="x" style="width: 12px; height: 12px;"></i> 페이지 삭제
        </button>
      </div>
    `;
    
    const deptInput = headerBar.querySelector(".page-dept-input");
    deptInput.addEventListener("input", (e) => {
      const pid = e.target.dataset.pageId;
      const targetPage = state.pages.find(p => p.id === pid);
      if (targetPage) {
        targetPage.department = e.target.value;
        localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
        
        // A4 점검표 헤더 타이틀 괄호 안 텍스트 실시간 반영
        const deptUnderlineBox = cardWrapper.querySelector(".dept-underline-box");
        if (deptUnderlineBox) {
          deptUnderlineBox.textContent = e.target.value || '      ';
        }
        
        // 바로가기 및 일괄적용 드롭다운 실시간 갱신 (화면 전체 렌더링 대신 DOM 직접 변경)
        const displayVal = e.target.value.trim() || "구분 미입력";
        const dropdownOptions = document.querySelectorAll(`option[value="${pid}"]`);
        dropdownOptions.forEach(opt => {
          opt.textContent = displayVal;
        });
      }
    });
    deptInput.addEventListener("change", (e) => {
      saveStateToStorage();
    });

    const pageInspectorInput = headerBar.querySelector(".page-inspector-input");
    pageInspectorInput.addEventListener("input", (e) => {
      const pid = e.target.dataset.pageId;
      const targetPage = state.pages.find(p => p.id === pid);
      if (targetPage) {
        targetPage.inspector = e.target.value;
        localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
        
        // A4 점검표 내 담당자 란 실시간 반영
        const inspectorUnderlineBox = cardWrapper.querySelector(".inspector-underline-box");
        if (inspectorUnderlineBox) {
          inspectorUnderlineBox.textContent = e.target.value || '      ';
        }
      }
    });
    pageInspectorInput.addEventListener("change", (e) => {
      saveStateToStorage();
    });

    headerBar.querySelector(".edit-equip-btn").addEventListener("click", () => openEquipModal(page.id));
    headerBar.querySelector(".delete-page-btn").addEventListener("click", () => deletePage(page.id));

    cardWrapper.appendChild(headerBar);

    // 2. 인쇄용 의료기기 일상점검 대장 본체
    const registerMain = document.createElement("div");
    registerMain.classList.add("printable-register");
    
    const titleDiv = document.createElement("div");
    titleDiv.classList.add("register-header");
    titleDiv.innerHTML = `
      <h2 class="register-title">
        의료기기 일상점검 관리 대장<span class="dept-parenthesis">( <span class="dept-underline-box">${page.department || '      '}</span> )</span>
      </h2>
      <div class="inspector-line">
        점검 담당자: <span class="inspector-underline-box">${page.inspector || '      '}</span>
      </div>
    `;
    registerMain.appendChild(titleDiv);
    
    const guideDiv = document.createElement("div");
    guideDiv.classList.add("instructions-wrapper");
    guideDiv.innerHTML = `
      <table class="instructions-table">
        <tr>
          <td class="inst-label">의료기기점검항목(공통점검)</td>
          <td class="inst-value">①작동상태(전원On/off) ②알람점검 ③케이블 상태 ④외관상태 ⑤청결 상태 등</td>
        </tr>
        <tr>
          <td class="inst-label">작성 요령</td>
          <td class="inst-value">적합은 V(verify) 표시, 부적합은 점검 내용 또는 점검번호로 표시한다.</td>
        </tr>
        <tr>
          <td class="inst-label">부적합 조치사항</td>
          <td class="inst-value">부적합 및 문제 발생 시 총무팀 구매 담당에게 연락 후 수리절차에 따른다.</td>
        </tr>
      </table>
    `;
    registerMain.appendChild(guideDiv);
    
    const tableContainer = document.createElement("div");
    tableContainer.classList.add("grid-table-container");
    
    let dayColsHtml = "";
    for (let d = 1; d <= 31; d++) {
      if (d <= daysInMonth) {
        const holidayName = getHolidayName(state.year, state.month, d);
        const isHolidayDay = holidayName !== "";
        const dayOfWeek = getDayOfWeek(state.year, state.month, d);
        let weekendClass = "";
        let titleAttr = "";
        
        if (isHolidayDay || dayOfWeek === 0) {
          weekendClass = " sunday"; // 공휴일 및 일요일 빨간색
          if (isHolidayDay) titleAttr = ` title="${holidayName}"`;
        } else if (dayOfWeek === 6) {
          weekendClass = " saturday"; // 토요일 파란색
        }
        dayColsHtml += `<th class="day-col${weekendClass}"${titleAttr}>${d}</th>`;
      } else {
        dayColsHtml += `<th style="background-color: #e2e8f0; color: #94a3b8;">-</th>`;
      }
    }
    
    const tableElement = document.createElement("table");
    tableElement.classList.add("checklist-table");
    const currentMonthStr = String(state.month).padStart(2, '0');
    
    tableElement.innerHTML = `
      <thead>
        <tr>
          <th rowspan="2" class="col-no">NO</th>
          <th rowspan="2" class="col-name">의료기기 목록</th>
          <th colspan="31" class="col-month-title">${state.year}년 ${currentMonthStr}월</th>
        </tr>
        <tr>
          ${dayColsHtml}
        </tr>
      </thead>
    `;
    
    const tbody = document.createElement("tbody");
    const pageData = currentMonthData[page.id] || {};
    
    for (let equipIndex = 0; equipIndex < 15; equipIndex++) {
      const equipName = pageEquipments[equipIndex] || "";
      const tr = document.createElement("tr");
      
      const tdNo = document.createElement("td");
      tdNo.textContent = equipIndex + 1;
      tr.appendChild(tdNo);
      
      const tdName = document.createElement("td");
      tdName.classList.add("col-name");
      tdName.textContent = equipName;
      tr.appendChild(tdName);
      
      const equipData = pageData[equipIndex] || {};
      
      for (let d = 1; d <= 31; d++) {
        const td = document.createElement("td");
        
        if (d <= daysInMonth) {
          td.classList.add("check-cell");
          td.dataset.pageId = page.id;
          td.dataset.equipIndex = equipIndex;
          td.dataset.day = d;
          
          const holidayName = getHolidayName(state.year, state.month, d);
          const isHolidayDay = holidayName !== "";
          const dayOfWeek = getDayOfWeek(state.year, state.month, d);
          
          if (isHolidayDay || dayOfWeek === 0) {
            td.classList.add("cell-weekend-sun"); // 공휴일 및 일요일 빨간색 배경
            if (isHolidayDay) td.title = holidayName; // 마우스 오버 시 공휴일 명칭 표시
          } else if (dayOfWeek === 6) {
            td.classList.add("cell-weekend-sat"); // 토요일 파란색 배경
          }
          
          const val = equipData[d] || "";
          
          // 공휴일/주말(토,일)에 데이터가 없으면 기본적으로 "-" 표시
          const holidayOrWeekend = isHolidayDay || dayOfWeek === 0 || dayOfWeek === 6;
          const displayVal = (val === "" && holidayOrWeekend) ? "-" : val;
          td.textContent = displayVal;
          
          if (displayVal === "V") {
            td.classList.add("val-v");
          } else if (["①", "②", "③", "④", "⑤"].some(code => displayVal.includes(code))) {
            td.classList.add("val-error");
          } else if (displayVal !== "" && displayVal !== "-") {
            td.classList.add("val-custom");
          }
          
          td.addEventListener("click", handleCellClick);
        } else {
          td.style.backgroundColor = "#e2e8f0";
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    
    tableElement.appendChild(tbody);
    tableContainer.appendChild(tableElement);
    registerMain.appendChild(tableContainer);
    
    const footerDiv = document.createElement("div");
    footerDiv.classList.add("register-footer");
    footerDiv.innerHTML = `
      <table class="signature-box">
        <tr>
          <td class="sig-cell">
            <div class="sig-label">담당자</div>
            <div class="sig-space"></div>
          </td>
          <td class="sig-cell">
            <div class="sig-label">파트장</div>
            <div class="sig-space"></div>
          </td>
          <td class="sig-cell">
            <div class="sig-label">부서장</div>
            <div class="sig-space"></div>
          </td>
        </tr>
      </table>
    `;
    registerMain.appendChild(footerDiv);
    
    cardWrapper.appendChild(registerMain);
    container.appendChild(cardWrapper);
  });
  
  // 포커싱 복원 (타이핑 도중 실시간 데이터 수신 시 커서 밀림 방지)
  if (activeElementId && activePageId) {
    let restoreEl = null;
    if (activeElementId.startsWith("page-dept-input-")) {
      restoreEl = document.getElementById(`page-dept-input-${activePageId}`);
    } else if (activeElementId.startsWith("page-inspector-input-")) {
      restoreEl = document.getElementById(`page-inspector-input-${activePageId}`);
    }
    
    if (restoreEl) {
      restoreEl.focus();
      if (cursorSelectionStart !== null) {
        restoreEl.setSelectionRange(cursorSelectionStart, cursorSelectionStart);
      }
    }
  }
  
  lucide.createIcons();
}

// ==========================================================================
// 4. 셀 인라인 드롭다운 제어
// ==========================================================================

function handleCellClick(e) {
  e.stopPropagation();
  const cell = e.currentTarget;
  const pageId = cell.dataset.pageId;
  const equipIndex = parseInt(cell.dataset.equipIndex);
  const day = parseInt(cell.dataset.day);
  
  activeCell = {
    pageId,
    equipIndex,
    day,
    element: cell
  };
  
  openCellDropdown(cell);
}

function openCellDropdown(cellElement) {
  const dropdown = document.getElementById("cell-dropdown-menu");
  dropdown.style.display = "block";
  
  const monthKey = `${state.year}-${state.month}`;
  const currentVal = state.checklistData[monthKey]?.[activeCell.pageId]?.[activeCell.equipIndex]?.[activeCell.day] || "";
  const customInput = document.getElementById("dropdown-custom-input");
  
  if (!["V", "①", "②", "③", "④", "⑤"].includes(currentVal) && currentVal !== "") {
    customInput.value = currentVal;
  } else {
    customInput.value = "";
  }
  
  const cellRect = cellElement.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();
  const scrollY = window.scrollY || window.pageYOffset;
  const scrollX = window.scrollX || window.pageXOffset;
  
  let topPosition = cellRect.bottom + scrollY;
  if (cellRect.bottom + dropdownRect.height > window.innerHeight + window.scrollY) {
    topPosition = cellRect.top + scrollY - dropdownRect.height;
  }
  
  let leftPosition = cellRect.left + scrollX;
  if (leftPosition + dropdownRect.width > window.innerWidth) {
    leftPosition = window.innerWidth - dropdownRect.width - 15;
  }
  
  dropdown.style.top = `${topPosition}px`;
  dropdown.style.left = `${leftPosition}px`;
}

function closeCellDropdown() {
  document.getElementById("cell-dropdown-menu").style.display = "none";
  activeCell = { pageId: null, equipIndex: null, day: null, element: null };
}

function updateCellValue(pageId, equipIndex, day, val) {
  const monthKey = `${state.year}-${state.month}`;
  
  // 1. 메모리 업데이트
  if (!state.checklistData[monthKey]) {
    state.checklistData[monthKey] = {};
  }
  if (!state.checklistData[monthKey][pageId]) {
    state.checklistData[monthKey][pageId] = {};
  }
  if (!state.checklistData[monthKey][pageId][equipIndex]) {
    state.checklistData[monthKey][pageId][equipIndex] = {};
  }
  state.checklistData[monthKey][pageId][equipIndex][day] = val;

  // 2. 동기화 및 백업 저장
  localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
  
  if (isCloudMode && dbRef) {
    // 다중 사용자 간 충돌 최소화를 위해 수정된 특정 셀 데이터만 Firebase에 핀포인트 덮어쓰기 실행
    dbRef.child(`checklistData/${monthKey}/${pageId}/${equipIndex}/${day}`).set(val);
  } else {
    // 로컬 모드일 때는 즉시 UI 부분 업데이트
    const card = document.getElementById(`page-card-${pageId}`);
    if (card) {
      const cell = card.querySelector(`.check-cell[data-equip-index="${equipIndex}"][data-day="${day}"]`);
      if (cell) {
        cell.textContent = val;
        cell.className = "check-cell"; 
        
        const dayOfWeek = getDayOfWeek(state.year, state.month, day);
        if (dayOfWeek === 6) cell.classList.add("cell-weekend-sat");
        if (dayOfWeek === 0) cell.classList.add("cell-weekend-sun");
        
        if (val === "V") {
          cell.classList.add("val-v");
        } else if (["①", "②", "③", "④", "⑤"].some(code => val.includes(code))) {
          cell.classList.add("val-error");
        } else if (val !== "") {
          cell.classList.add("val-custom");
        }
      }
    }
  }
}

// ==========================================================================
// 5. 페이지 제어 로직 (Page CRUD)
// ==========================================================================

function addPage() {
  const newPageId = `page_${Date.now()}`;
  const newPageNum = state.pages.length + 1;
  state.pages.push({
    id: newPageId,
    name: `페이지 ${newPageNum}`,
    department: "",
    inspector: "",
    equipment: sanitizeEquipmentList([])
  });
  
  saveStateToStorage();
  updateDropdowns();
  renderAllPageSheets();
  
  setTimeout(() => {
    const newCard = document.getElementById(`page-card-${newPageId}`);
    if (newCard) {
      newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function deletePage(pageId) {
  if (state.pages.length <= 1) {
    alert("최소 1개 이상의 페이지가 유지되어야 하므로 삭제할 수 없습니다.");
    return;
  }
  
  const page = state.pages.find(p => p.id === pageId);
  const pageDisplayName = page.department || "구분 미설정";
  if (confirm(`'${pageDisplayName}' 페이지와 기록된 데이터가 모두 영구 삭제됩니다. 계속하시겠습니까?`)) {
    if (!checkAdminAccess()) return;
    
    const index = state.pages.findIndex(p => p.id === pageId);
    state.pages.splice(index, 1);
    
    const monthKey = `${state.year}-${state.month}`;
    if (state.checklistData[monthKey] && state.checklistData[monthKey][pageId]) {
      delete state.checklistData[monthKey][pageId];
    }
    
    // 로컬과 파베에 동시 반영
    localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
    if (isCloudMode && dbRef) {
      dbRef.child("pages").set(state.pages);
      dbRef.child(`checklistData/${monthKey}/${pageId}`).remove();
    }
    
    updateDropdowns();
    renderAllPageSheets();
    alert("페이지가 삭제되었습니다.");
  }
}

function clearPageMonthData(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  const pageDisplayName = page.department || "구분 미설정";
  if (confirm(`정말 '${pageDisplayName}'의 이번 달(${state.year}년 ${state.month}월) 점검 데이터를 전부 초기화하시겠습니까? (기기명 목록은 유지됩니다)`)) {
    if (!checkAdminAccess()) return;
    
    const monthKey = `${state.year}-${state.month}`;
    if (state.checklistData[monthKey]) {
      state.checklistData[monthKey][pageId] = {};
    }
    
    localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
    if (isCloudMode && dbRef) {
      dbRef.child(`checklistData/${monthKey}/${pageId}`).set({});
    }
    
    renderAllPageSheets();
    alert("해당 페이지의 이번 달 점검 데이터가 초기화되었습니다.");
  }
}

// 모든 페이지의 이번 달 점검 데이터 초기화
function clearAllPagesMonthData() {
  if (confirm(`정말 모든 페이지의 이번 달(${state.year}년 ${state.month}월) 점검 데이터를 전부 초기화하시겠습니까?\n(기기명 목록은 유지됩니다)`)) {
    if (!checkAdminAccess()) return;
    
    const monthKey = `${state.year}-${state.month}`;
    if (state.checklistData[monthKey]) {
      state.pages.forEach(page => {
        state.checklistData[monthKey][page.id] = {};
      });
    }
    
    localStorage.setItem("medical_equip_state_scroll_v1", JSON.stringify(state));
    if (isCloudMode && dbRef) {
      dbRef.child(`checklistData/${monthKey}`).set({});
    }
    
    renderAllPageSheets();
    alert("모든 페이지의 이번 달 점검 데이터가 초기화되었습니다.");
  }
}

// ==========================================================================
// 6. 장비 편집 모달 제어 (15개 고정 입력)
// ==========================================================================

function openEquipModal(pageId) {
  const modal = document.getElementById("equip-modal");
  const page = state.pages.find(p => p.id === pageId);
  activeModalPageId = pageId;
  
  document.getElementById("modal-page-title").textContent = page.department || "구분 미설정";
  modal.classList.add("active");
  renderEquipInputsInModal();
}

function closeEquipModal() {
  const modal = document.getElementById("equip-modal");
  modal.classList.remove("active");
  activeModalPageId = null;
}

function renderEquipInputsInModal() {
  const container = document.getElementById("equip-inputs-container");
  container.innerHTML = "";
  
  const page = state.pages.find(p => p.id === activeModalPageId);
  const equipment = sanitizeEquipmentList(page.equipment);
  
  for (let i = 0; i < 15; i++) {
    const itemDiv = document.createElement("div");
    itemDiv.classList.add("equip-input-item");
    
    itemDiv.innerHTML = `
      <span class="equip-input-label">${i + 1}</span>
      <input type="text" class="equip-input-field" data-index="${i}" value="${equipment[i]}" placeholder="${i + 1}번 의료기기 명칭...">
    `;
    container.appendChild(itemDiv);
  }
}

function clearAllModalInputs() {
  if (confirm("현재 기기 편집창의 모든 입력을 완전히 지우시겠습니까?")) {
    if (!checkAdminAccess()) return;
    
    const inputs = document.querySelectorAll(".equip-input-field");
    inputs.forEach(input => {
      input.value = "";
    });
  }
}

function applyEquipChanges() {
  const page = state.pages.find(p => p.id === activeModalPageId);
  const inputs = document.querySelectorAll(".equip-input-field");
  const newEquipment = [];
  
  inputs.forEach(input => {
    newEquipment.push(input.value.trim());
  });
  
  page.equipment = sanitizeEquipmentList(newEquipment);
  saveStateToStorage();
  renderAllPageSheets();
  updateDropdowns();
  closeEquipModal();
}

// ==========================================================================
// 7. 일괄 입력 도구 (Toolbar Operations)
// ==========================================================================

function fillTodayAllV() {
  const today = new Date();
  if (today.getFullYear() === state.year && (today.getMonth() + 1) === state.month) {
    const day = today.getDate();
    fillDayAllV(day);
  } else {
    alert("선택된 점검 년/월이 이번 달과 다릅니다. 일자 선택 도구를 사용해주세요.");
  }
}

function fillDayAllV(day) {
  if (!day) return;
  
  if (confirm(`모든 페이지의 ${day}일 등록 기기 결과를 '적합(V)'으로 입력하시겠습니까?\n(공휴일/주말은 '-'로 표시됩니다)`)) {
    const holidayName = getHolidayName(state.year, state.month, day);
    const dayOfWeek = getDayOfWeek(state.year, state.month, day);
    const isHoliday = holidayName !== "" || dayOfWeek === 0 || dayOfWeek === 6;
    
    state.pages.forEach(page => {
      for (let index = 0; index < 15; index++) {
        if (page.equipment[index] && page.equipment[index].trim()) {
          if (isHoliday) {
            updateCellValue(page.id, index, day, "-");
          } else {
            updateCellValue(page.id, index, day, "V");
          }
        }
      }
    });
  }
}

function fillEquipMonthAllV(equipIndex) {
  if (equipIndex === null || equipIndex === undefined || equipIndex === "") return;
  
  const targetPageId = document.getElementById("batch-page-select").value;
  if (!targetPageId) {
    alert("일괄 입력을 적용할 대상 페이지를 선택해 주세요.");
    return;
  }
  
  const page = state.pages.find(p => p.id === targetPageId);
  const name = page.equipment[equipIndex];
  const displayName = name.trim() ? name : `${equipIndex + 1}번 장비`;
  const daysInMonth = getDaysInMonth(state.year, state.month);
  const pageDisplayName = page.department || "구분 미설정";
  
  if (confirm(`'${pageDisplayName}'의 '${displayName}' 기기 한 달 전체 결과를 '적합(V)'으로 입력하시겠습니까?\n(공휴일은 '-'로 표시됩니다)`)) {
    for (let d = 1; d <= daysInMonth; d++) {
      const holidayName = getHolidayName(state.year, state.month, d);
      const dayOfWeek = getDayOfWeek(state.year, state.month, d);
      const isHoliday = holidayName !== "" || dayOfWeek === 0 || dayOfWeek === 6;
      
      if (isHoliday) {
        updateCellValue(targetPageId, equipIndex, d, "-");
      } else {
        updateCellValue(targetPageId, equipIndex, d, "V");
      }
    }
  }
}

// 이번 달 모두 적합: 모든 페이지의 등록된 모든 기기에 대해 한 달 전체 V (공휴일은 - )
function fillMonthAllEquipAllV() {
  const daysInMonth = getDaysInMonth(state.year, state.month);
  
  if (confirm(`모든 페이지의 등록된 모든 기기에 대해\n${state.year}년 ${state.month}월 전체를 '적합(V)'으로 입력하시겠습니까?\n(공휴일/주말은 '-'로 표시됩니다)`)) {
    state.pages.forEach(page => {
      for (let equipIndex = 0; equipIndex < 15; equipIndex++) {
        if (page.equipment[equipIndex] && page.equipment[equipIndex].trim()) {
          for (let d = 1; d <= daysInMonth; d++) {
            const holidayName = getHolidayName(state.year, state.month, d);
            const dayOfWeek = getDayOfWeek(state.year, state.month, d);
            const isHoliday = holidayName !== "" || dayOfWeek === 0 || dayOfWeek === 6;
            
            if (isHoliday) {
              updateCellValue(page.id, equipIndex, d, "-");
            } else {
              updateCellValue(page.id, equipIndex, d, "V");
            }
          }
        }
      }
    });
  }
}

// ==========================================================================
// 8. 백업 및 인쇄 제어
// ==========================================================================

function exportBackup() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `의료기기점검대장_백업_${dateStr}.json`;
  const jsonStr = JSON.stringify(state, null, 2);
  
  // File System Access API 지원 시 저장 위치 선택 다이얼로그 제공
  if (window.showSaveFilePicker) {
    (async () => {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: "JSON 백업 파일",
            accept: { "application/json": [".json"] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        alert("백업 파일이 저장되었습니다.");
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("저장 실패:", err);
          // 폴백: 기존 다운로드 방식
          downloadBackupFallback(jsonStr, fileName);
        }
      }
    })();
  } else {
    // 미지원 브라우저 폴백
    downloadBackupFallback(jsonStr, fileName);
  }
}

function downloadBackupFallback(jsonStr, fileName) {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", fileName);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function triggerImport() {
  // File System Access API 지원 시 파일 선택 다이얼로그 (위치 탐색 가능)
  if (window.showOpenFilePicker) {
    (async () => {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: "JSON 백업 파일",
            accept: { "application/json": [".json"] }
          }],
          multiple: false
        });
        const file = await handle.getFile();
        const text = await file.text();
        processImportData(text);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("파일 열기 실패:", err);
          // 폴백
          document.getElementById("import-file-input").click();
        }
      }
    })();
  } else {
    document.getElementById("import-file-input").click();
  }
}

function processImportData(text) {
  try {
    const importedState = JSON.parse(text);
    if (importedState.pages && importedState.checklistData) {
      if (confirm("백업 데이터를 복원하시겠습니까? 기존 정보가 모두 덮어씌워집니다.")) {
        state = { ...state, ...importedState };
        
        state.pages.forEach(page => {
          page.equipment = sanitizeEquipmentList(page.equipment);
        });
        
        saveStateToStorage();
        initSelectors();
        renderAllPageSheets();
        alert("데이터 백업이 성공적으로 복원되었습니다.");
      }
    } else {
      alert("유효한 백업 파일 형식이 아닙니다.");
    }
  } catch (err) {
    alert("파일 복원 중 에러 발생: " + err.message);
  }
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    processImportData(evt.target.result);
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ==========================================================================
// 9. 초기 이벤트 리스너 바인딩 및 어플리케이션 초기 가동
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  // 1. 동기화 방식 확인 및 리스너 가동 (클라우드 vs 로컬 포백)
  initStorageMode();
  
  // 공휴일 API 데이터 비동기 로드
  fetchHolidays();
  
  // 2. 상단 년/월 변경 리스너
  document.getElementById("select-year").addEventListener("change", (e) => {
    state.year = parseInt(e.target.value);
    saveStateToStorage();
    renderAllPageSheets();
    updateBatchEquipmentDropdown();
  });
  
  document.getElementById("select-month").addEventListener("change", (e) => {
    state.month = parseInt(e.target.value);
    saveStateToStorage();
    renderAllPageSheets();
    updateBatchEquipmentDropdown();
  });



  // 4. 페이지 바로가기 스크롤 네비게이션
  document.getElementById("quick-page-select").addEventListener("change", (e) => {
    const targetPageId = e.target.value;
    if (targetPageId) {
      const card = document.getElementById(`page-card-${targetPageId}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      e.target.value = ""; 
    }
  });

  // 5. 하단 고정 페이지 대형 추가 단추
  document.getElementById("add-page-btn-large").addEventListener("click", addPage);

  // 6. 현재 페이지 기기 편집 모달 단추
  document.getElementById("close-equip-modal").addEventListener("click", closeEquipModal);
  document.getElementById("save-equip-btn").addEventListener("click", applyEquipChanges);
  document.getElementById("reset-equip-btn").addEventListener("click", clearAllModalInputs);

  // 7. 셀 인라인 드롭다운 리스너
  const dropdownMenu = document.getElementById("cell-dropdown-menu");
  
  dropdownMenu.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const val = e.currentTarget.dataset.val;
      if (activeCell.element) {
        updateCellValue(activeCell.pageId, activeCell.equipIndex, activeCell.day, val);
        closeCellDropdown();
      }
    });
  });
  
  document.getElementById("dropdown-custom-save").addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeCell.element) {
      const val = document.getElementById("dropdown-custom-input").value.trim();
      updateCellValue(activeCell.pageId, activeCell.equipIndex, activeCell.day, val);
      closeCellDropdown();
    }
  });

  document.getElementById("dropdown-custom-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.stopPropagation();
      if (activeCell.element) {
        const val = e.target.value.trim();
        updateCellValue(activeCell.pageId, activeCell.equipIndex, activeCell.day, val);
        closeCellDropdown();
      }
    }
  });

  document.addEventListener("click", () => {
    if (dropdownMenu.style.display === "block") {
      closeCellDropdown();
    }
  });

  // 8. 일괄 입력 도구 상호작용
  document.getElementById("batch-page-select").addEventListener("change", updateBatchEquipmentDropdown);

  document.getElementById("batch-fill-today").addEventListener("click", fillTodayAllV);
  
  document.getElementById("batch-fill-day-btn").addEventListener("click", () => {
    const dayVal = document.getElementById("batch-day-select").value;
    if (dayVal) fillDayAllV(parseInt(dayVal));
    else alert("일괄 입력할 일자를 선택해주세요.");
  });
  
  document.getElementById("batch-fill-equip-btn").addEventListener("click", () => {
    const equipVal = document.getElementById("batch-equip-select").value;
    if (equipVal !== "") fillEquipMonthAllV(parseInt(equipVal));
    else alert("일괄 입력할 기기를 선택해주세요.");
  });

  document.getElementById("batch-fill-month-all-btn").addEventListener("click", fillMonthAllEquipAllV);

  document.getElementById("batch-reset-month-btn").addEventListener("click", clearAllPagesMonthData);

  // 9. 상단 공통 동작 단추들
  document.getElementById("pdf-btn").addEventListener("click", () => {
    alert("인쇄 대화상자가 열리면 대상(프린터)을 'PDF로 저장' 또는 'Microsoft Print to PDF'로 지정해 주세요.");
    window.print();
  });
  document.getElementById("print-btn").addEventListener("click", () => window.print());

  // 10. 백업 내보내기 / 가져오기
  document.getElementById("export-btn").addEventListener("click", exportBackup);
  document.getElementById("import-btn").addEventListener("click", triggerImport);
  document.getElementById("import-file-input").addEventListener("change", handleImportFile);
});
