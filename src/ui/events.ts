import { domRefs } from "./domRefs";

export interface HandlerSet {
  // File upload
  onFileChange: () => Promise<void>;
  // Cohort
  onCohortSelectChange: () => void;
  onDownloadButtonClick: () => void;
  // Notification / modal
  onOpenNotificationDrawerButtonClick: () => void;
  onOpenConflictDetailModalButtonClick: () => void;
  onCloseConflictDetailModalButtonClick: () => void;
  onConflictDetailModalCancel: (event: Event) => void;
  onConflictDetailModalClick: (event: MouseEvent) => void;
  // Quick nav
  onOpenInstructorDrawerButtonClick: () => void;
  onQuickNavCourseButtonClick: () => void;
  onQuickNavSubjectButtonClick: () => void;
  onQuickNavInstructorButtonClick: () => void;
  onQuickNavMappingButtonClick: () => void;
  // Timeline
  onTimelineViewTypeSelectChange: () => void;
  onAssigneeModeInstructorButtonClick: () => void;
  onAssigneeModeStaffButtonClick: () => void;
  onWeekPrevButtonClick: () => void;
  onWeekNextButtonClick: () => void;
  onMonthPrevButtonClick: () => void;
  onMonthNextButtonClick: () => void;
  // Drawers / keyboard
  onDrawerBackdropClick: () => void;
  onCloseDrawerButtonClick: () => void;
  onWindowKeydown: (event: KeyboardEvent) => void;
  onWindowResize: () => void;
  // Conflicts
  onComputeConflictsButtonClick: () => void;
  onKeySearchInputInput: () => void;
  onInstructorDaySearchInputInput: () => void;
  onFoDaySearchInputInput: () => void;
  onDownloadTimeConflictsButtonClick: () => void;
  onDownloadInstructorDayConflictsButtonClick: () => void;
  onDownloadFoDayConflictsButtonClick: () => void;
  onTabTimeConflictsClick: () => void;
  onTabInstructorDayConflictsClick: () => void;
  onTabFoDayConflictsClick: () => void;
  // Holidays / breaks
  onAddHolidayButtonClick: () => void;
  onLoadPublicHolidaysButtonClick: () => void;
  onClearHolidaysButtonClick: () => void;
  onDedupeHolidaysButtonClick: () => void;
  onAddCustomBreakButtonClick: () => void;
  // Schedule templates
  onScheduleTemplateSelectChange: () => void;
  onLoadScheduleTemplateButtonClick: () => void;
  onSaveScheduleTemplateButtonClick: () => void;
  onDeleteScheduleTemplateButtonClick: () => void;
  // Schedule generation
  onGenerateScheduleButtonClick: () => void;
  onAppendScheduleButtonClick: () => void;
  onPushScheduleToConflictsChange: () => void;
  // Staffing
  onStaffAutoFillButtonClick: () => void;
  onStaffRefreshButtonClick: () => void;
  onStaffingModeSelectChange: () => void;
  onAdminModeToggleChange: () => void;
  // Menu config
  onSaveMenuConfigButtonClick: () => void;
  onResetMenuConfigButtonClick: () => void;
  // Jibble navigation
  onJibbleSubCourseButtonClick: () => void;
  onJibbleSubSubjectButtonClick: () => void;
  onJibbleSubInstructorButtonClick: () => void;
  // Instructor drawer tabs
  onInstructorTabCourseClick: () => void;
  onInstructorTabRegisterClick: () => void;
  onInstructorTabMappingClick: () => void;
  onInstructorTabSubjectClick: () => void;
  // Registry
  onUpsertCourseButtonClick: () => void;
  onUpsertInstructorButtonClick: () => void;
  onUpsertSubjectButtonClick: () => void;
  onApplySubjectMappingsButtonClick: () => void;
  onSubjectCourseSelectChange: () => void;
  onMappingCourseSelectChange: () => void;
  // Course templates
  onCourseTemplateCourseSelectChange: () => void;
  onSaveCourseTemplateButtonClick: () => void;
  onLoadCourseTemplateButtonClick: () => void;
  onDeleteCourseTemplateButtonClick: () => void;
  // Staff export
  onStaffExportCsvButtonClick: () => void;
  onStaffExportModeSelectChange: () => void;
  onStaffExportIncludeDetailsChange: () => void;
  onStaffExportWarningsAgreeChange: () => void;
  // Project state
  onSaveProjectButtonClick: () => void;
  onLoadProjectButtonClick: () => void;
  onLoadProjectInputChange: () => Promise<void>;
  onResetProjectButtonClick: () => void;
  onPrintReportButtonClick: () => void;
  // Demo / auth
  onLoadDemoSampleButtonClick: () => Promise<void>;
  onRestorePreviousStateButtonClick: () => void;
  onAuthLoginButtonClick: () => void;
  onAuthCodeInputKeydown: (event: KeyboardEvent) => void;
  // Schedule inputs
  onScheduleInputInput: () => void;
  // Day template table
  onDayTemplateTableInput: () => void;
  onDayTemplateTableInputTemplateStatus: () => void;
  // Print
  onWindowAfterprint: () => void;
}

export function initEventListeners(handlers: HandlerSet): void {
  const {
    fileInput,
    cohortSelect,
    downloadButton,
    openNotificationDrawerButton,
    openConflictDetailModalButton,
    closeConflictDetailModalButton,
    conflictDetailModal,
    openInstructorDrawerButton,
    quickNavCourseButton,
    quickNavSubjectButton,
    quickNavInstructorButton,
    quickNavMappingButton,
    timelineViewTypeSelect,
    assigneeModeInstructorButton,
    assigneeModeStaffButton,
    weekPrevButton,
    weekNextButton,
    monthPrevButton,
    monthNextButton,
    drawerBackdrop,
    computeConflictsButton,
    keySearchInput,
    instructorDaySearchInput,
    foDaySearchInput,
    downloadTimeConflictsButton,
    downloadInstructorDayConflictsButton,
    downloadFoDayConflictsButton,
    tabTimeConflicts,
    tabInstructorDayConflicts,
    tabFoDayConflicts,
    addHolidayButton,
    loadPublicHolidaysButton,
    clearHolidaysButton,
    dedupeHolidaysButton,
    addCustomBreakButton,
    scheduleTemplateSelect,
    loadScheduleTemplateButton,
    saveScheduleTemplateButton,
    deleteScheduleTemplateButton,
    generateScheduleButton,
    appendScheduleButton,
    pushScheduleToConflicts,
    staffAutoFillButton,
    staffRefreshButton,
    staffingModeSelect,
    adminModeToggle,
    saveMenuConfigButton,
    resetMenuConfigButton,
    jibbleSubCourseButton,
    jibbleSubSubjectButton,
    jibbleSubInstructorButton,
    instructorTabCourse,
    instructorTabRegister,
    instructorTabMapping,
    instructorTabSubject,
    upsertCourseButton,
    upsertInstructorButton,
    upsertSubjectButton,
    applySubjectMappingsButton,
    subjectCourseSelect,
    mappingCourseSelect,
    courseTemplateCourseSelect,
    saveCourseTemplateButton,
    loadCourseTemplateButton,
    deleteCourseTemplateButton,
    staffExportCsvButton,
    staffExportModeSelect,
    staffExportIncludeDetails,
    staffExportWarningsAgree,
    saveProjectButton,
    loadProjectButton,
    loadProjectInput,
    resetProjectButton,
    printReportButton,
    loadDemoSampleButton,
    restorePreviousStateButton,
    authLoginButton,
    authCodeInput,
    scheduleCohortInput,
    scheduleStartDateInput,
    scheduleTotalHoursInput,
    scheduleInstructorCodeInput,
    scheduleClassroomCodeInput,
    scheduleSubjectCodeInput,
    staffP1WeeksInput,
    staff365WeeksInput,
    dayTemplateTable,
  } = domRefs;

  fileInput.addEventListener("change", handlers.onFileChange);
  cohortSelect.addEventListener("change", handlers.onCohortSelectChange);
  downloadButton.addEventListener("click", handlers.onDownloadButtonClick);

  openNotificationDrawerButton.addEventListener("click", handlers.onOpenNotificationDrawerButtonClick);
  openConflictDetailModalButton.addEventListener("click", handlers.onOpenConflictDetailModalButtonClick);
  closeConflictDetailModalButton.addEventListener("click", handlers.onCloseConflictDetailModalButtonClick);
  conflictDetailModal.addEventListener("cancel", handlers.onConflictDetailModalCancel);
  conflictDetailModal.addEventListener("click", handlers.onConflictDetailModalClick);

  openInstructorDrawerButton.addEventListener("click", handlers.onOpenInstructorDrawerButtonClick);
  quickNavCourseButton.addEventListener("click", handlers.onQuickNavCourseButtonClick);
  quickNavSubjectButton.addEventListener("click", handlers.onQuickNavSubjectButtonClick);
  quickNavInstructorButton.addEventListener("click", handlers.onQuickNavInstructorButtonClick);
  quickNavMappingButton.addEventListener("click", handlers.onQuickNavMappingButtonClick);

  timelineViewTypeSelect.addEventListener("change", handlers.onTimelineViewTypeSelectChange);
  assigneeModeInstructorButton.addEventListener("click", handlers.onAssigneeModeInstructorButtonClick);
  assigneeModeStaffButton.addEventListener("click", handlers.onAssigneeModeStaffButtonClick);
  weekPrevButton.addEventListener("click", handlers.onWeekPrevButtonClick);
  weekNextButton.addEventListener("click", handlers.onWeekNextButtonClick);
  monthPrevButton.addEventListener("click", handlers.onMonthPrevButtonClick);
  monthNextButton.addEventListener("click", handlers.onMonthNextButtonClick);

  drawerBackdrop.addEventListener("click", handlers.onDrawerBackdropClick);
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-close-drawer]"))) {
    button.addEventListener("click", handlers.onCloseDrawerButtonClick);
  }
  window.addEventListener("keydown", handlers.onWindowKeydown);
  window.addEventListener("resize", handlers.onWindowResize);

  computeConflictsButton.addEventListener("click", handlers.onComputeConflictsButtonClick);

  keySearchInput.addEventListener("input", handlers.onKeySearchInputInput);
  instructorDaySearchInput.addEventListener("input", handlers.onInstructorDaySearchInputInput);
  foDaySearchInput.addEventListener("input", handlers.onFoDaySearchInputInput);

  downloadTimeConflictsButton.addEventListener("click", handlers.onDownloadTimeConflictsButtonClick);
  downloadInstructorDayConflictsButton.addEventListener("click", handlers.onDownloadInstructorDayConflictsButtonClick);
  downloadFoDayConflictsButton.addEventListener("click", handlers.onDownloadFoDayConflictsButtonClick);

  tabTimeConflicts.addEventListener("click", handlers.onTabTimeConflictsClick);
  tabInstructorDayConflicts.addEventListener("click", handlers.onTabInstructorDayConflictsClick);
  tabFoDayConflicts.addEventListener("click", handlers.onTabFoDayConflictsClick);

  addHolidayButton.addEventListener("click", handlers.onAddHolidayButtonClick);
  loadPublicHolidaysButton.addEventListener("click", handlers.onLoadPublicHolidaysButtonClick);
  clearHolidaysButton.addEventListener("click", handlers.onClearHolidaysButtonClick);
  dedupeHolidaysButton.addEventListener("click", handlers.onDedupeHolidaysButtonClick);
  addCustomBreakButton.addEventListener("click", handlers.onAddCustomBreakButtonClick);

  scheduleTemplateSelect.addEventListener("change", handlers.onScheduleTemplateSelectChange);
  loadScheduleTemplateButton.addEventListener("click", handlers.onLoadScheduleTemplateButtonClick);
  saveScheduleTemplateButton.addEventListener("click", handlers.onSaveScheduleTemplateButtonClick);
  deleteScheduleTemplateButton.addEventListener("click", handlers.onDeleteScheduleTemplateButtonClick);

  generateScheduleButton.addEventListener("click", handlers.onGenerateScheduleButtonClick);
  appendScheduleButton.addEventListener("click", handlers.onAppendScheduleButtonClick);
  pushScheduleToConflicts.addEventListener("change", handlers.onPushScheduleToConflictsChange);

  staffAutoFillButton.addEventListener("click", handlers.onStaffAutoFillButtonClick);
  staffRefreshButton.addEventListener("click", handlers.onStaffRefreshButtonClick);
  staffingModeSelect.addEventListener("change", handlers.onStaffingModeSelectChange);
  if (adminModeToggle) {
    adminModeToggle.addEventListener("change", handlers.onAdminModeToggleChange);
  }

  saveMenuConfigButton.addEventListener("click", handlers.onSaveMenuConfigButtonClick);
  resetMenuConfigButton.addEventListener("click", handlers.onResetMenuConfigButtonClick);

  jibbleSubCourseButton?.addEventListener("click", handlers.onJibbleSubCourseButtonClick);
  jibbleSubSubjectButton?.addEventListener("click", handlers.onJibbleSubSubjectButtonClick);
  jibbleSubInstructorButton?.addEventListener("click", handlers.onJibbleSubInstructorButtonClick);

  instructorTabCourse.addEventListener("click", handlers.onInstructorTabCourseClick);
  instructorTabRegister.addEventListener("click", handlers.onInstructorTabRegisterClick);
  instructorTabMapping.addEventListener("click", handlers.onInstructorTabMappingClick);
  instructorTabSubject.addEventListener("click", handlers.onInstructorTabSubjectClick);
  upsertCourseButton.addEventListener("click", handlers.onUpsertCourseButtonClick);
  upsertInstructorButton.addEventListener("click", handlers.onUpsertInstructorButtonClick);
  upsertSubjectButton.addEventListener("click", handlers.onUpsertSubjectButtonClick);
  applySubjectMappingsButton.addEventListener("click", handlers.onApplySubjectMappingsButtonClick);
  subjectCourseSelect.addEventListener("change", handlers.onSubjectCourseSelectChange);
  mappingCourseSelect.addEventListener("change", handlers.onMappingCourseSelectChange);
  courseTemplateCourseSelect.addEventListener("change", handlers.onCourseTemplateCourseSelectChange);
  saveCourseTemplateButton.addEventListener("click", handlers.onSaveCourseTemplateButtonClick);
  loadCourseTemplateButton.addEventListener("click", handlers.onLoadCourseTemplateButtonClick);
  deleteCourseTemplateButton.addEventListener("click", handlers.onDeleteCourseTemplateButtonClick);

  staffExportCsvButton.addEventListener("click", handlers.onStaffExportCsvButtonClick);
  staffExportModeSelect.addEventListener("change", handlers.onStaffExportModeSelectChange);
  staffExportIncludeDetails.addEventListener("change", handlers.onStaffExportIncludeDetailsChange);
  staffExportWarningsAgree.addEventListener("change", handlers.onStaffExportWarningsAgreeChange);

  saveProjectButton.addEventListener("click", handlers.onSaveProjectButtonClick);
  loadProjectButton.addEventListener("click", handlers.onLoadProjectButtonClick);
  loadProjectInput.addEventListener("change", handlers.onLoadProjectInputChange);
  resetProjectButton.addEventListener("click", handlers.onResetProjectButtonClick);
  printReportButton.addEventListener("click", handlers.onPrintReportButtonClick);

  loadDemoSampleButton.addEventListener("click", handlers.onLoadDemoSampleButtonClick);
  restorePreviousStateButton.addEventListener("click", handlers.onRestorePreviousStateButtonClick);
  authLoginButton.addEventListener("click", handlers.onAuthLoginButtonClick);
  authCodeInput.addEventListener("keydown", handlers.onAuthCodeInputKeydown);

  const scheduleInputsForAutoSave: Array<HTMLInputElement> = [
    scheduleCohortInput,
    scheduleStartDateInput,
    scheduleTotalHoursInput,
    scheduleInstructorCodeInput,
    scheduleClassroomCodeInput,
    scheduleSubjectCodeInput,
    staffP1WeeksInput,
    staff365WeeksInput,
  ];
  for (const input of scheduleInputsForAutoSave) {
    input.addEventListener("input", handlers.onScheduleInputInput);
  }

  dayTemplateTable.addEventListener("input", handlers.onDayTemplateTableInput);
  dayTemplateTable.addEventListener("input", handlers.onDayTemplateTableInputTemplateStatus);

  window.addEventListener("afterprint", handlers.onWindowAfterprint);
}
