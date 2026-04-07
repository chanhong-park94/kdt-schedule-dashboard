/**
 * HWPX 생성 엔진
 * 출석입력요청대장 (별지 제14호 서식) 자동 생성
 *
 * 전략: 원본 HWPX 템플릿의 XML 구조를 정확히 재현하여
 * 한컴오피스에서 정상적으로 열리는 HWPX 파일 생성.
 * JSZip으로 패키징하여 브라우저에서 다운로드.
 *
 * 구조:
 *   mimetype (비압축)
 *   version.xml
 *   Contents/content.hpf (매니페스트)
 *   Contents/header.xml (스타일 정의 - gzip+base64 임베딩)
 *   Contents/section0.xml (본문 - 동적 생성)
 *   BinData/image1.png (관리자 서명 이미지, 선택)
 */
import JSZip from "jszip";
import type { ExcuseRecord, DocConfig } from "./docAutomationApi";
// 원본 header.xml을 Vite raw import로 번들 (144KB)
import HEADER_XML_RAW from "./template/header.xml?raw";

// ── 상수 ──────────────────────────────────────────────
const ROWS_PER_PAGE = 15;
const MIMETYPE_CONTENT = "application/hwp+zip";

/** HWPX XML 네임스페이스 */
const NS = {
  ha: "http://www.hancom.co.kr/hwpml/2011/app",
  hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
  hp10: "http://www.hancom.co.kr/hwpml/2016/paragraph",
  hs: "http://www.hancom.co.kr/hwpml/2011/section",
  hc: "http://www.hancom.co.kr/hwpml/2011/core",
  hh: "http://www.hancom.co.kr/hwpml/2011/head",
  hhs: "http://www.hancom.co.kr/hwpml/2011/history",
  hm: "http://www.hancom.co.kr/hwpml/2011/master-page",
  hpf: "http://www.hancom.co.kr/schema/2011/hpf",
  dc: "http://purl.org/dc/elements/1.1/",
  opf: "http://www.idpf.org/2007/opf/",
  ooxmlchart: "http://www.hancom.co.kr/hwpml/2016/ooxmlchart",
  hwpunitchar: "http://www.hancom.co.kr/hwpml/2016/HwpUnitChar",
  epub: "http://www.idpf.org/2007/ops",
  config: "urn:oasis:names:tc:opendocument:xmlns:config:1.0",
} as const;

/** xmlns 속성 문자열 (section, header, content.hpf 공통) */
const XMLNS_ATTRS = Object.entries(NS)
  .map(([k, v]) => `xmlns:${k}="${v}"`)
  .join(" ");

// ── version.xml ────────────────────────────────────────
const VERSION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"' +
  ' tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1"' +
  ' buildNumber="0" os="1" xmlVersion="1.5"' +
  ' application="Hancom Office Hangul" appVersion="13, 0, 0, 564 WIN32LEWindows_10"/>';

// ── XML 이스케이프 ─────────────────────────────────────
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── lineseg 헬퍼 ───────────────────────────────────────
function lineseg(horzsize: number, vertsize = 1000, spacing = 0, vertpos = 0): string {
  const textheight = vertsize;
  const baseline = Math.round(vertsize * 0.85);
  return (
    "<hp:linesegarray>" +
    `<hp:lineseg textpos="0" vertpos="${vertpos}" vertsize="${vertsize}"` +
    ` textheight="${textheight}" baseline="${baseline}" spacing="${spacing}"` +
    ` horzpos="0" horzsize="${horzsize}" flags="393216"/>` +
    "</hp:linesegarray>"
  );
}

// ── 셀 생성 헬퍼 ──────────────────────────────────────
interface CellOpts {
  colAddr: number;
  rowAddr: number;
  colSpan: number;
  rowSpan?: number;
  width: number;
  height: number;
  borderFillIDRef: string;
  hasMargin?: boolean;
  lineWrap?: string;
  content: string; // inner <hp:p> elements
}

function buildCell(opts: CellOpts): string {
  const {
    colAddr,
    rowAddr,
    colSpan,
    rowSpan = 1,
    width,
    height,
    borderFillIDRef,
    hasMargin = false,
    lineWrap = "SQUEEZE",
    content,
  } = opts;
  const margin = hasMargin
    ? '<hp:cellMargin left="141" right="141" top="141" bottom="141"/>'
    : '<hp:cellMargin left="140" right="140" top="140" bottom="140"/>';
  return (
    `<hp:tc name="" header="0" hasMargin="${hasMargin ? "1" : "0"}"` +
    ` protect="0" editable="0" dirty="0" borderFillIDRef="${borderFillIDRef}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="${lineWrap}" vertAlign="CENTER"` +
    ` linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"` +
    ` hasTextRef="0" hasNumRef="0">` +
    content +
    "</hp:subList>" +
    `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"/>` +
    `<hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>` +
    `<hp:cellSz width="${width}" height="${height}"/>` +
    margin +
    "</hp:tc>"
  );
}

/** 텍스트 포함 단일 p 요소 */
function textP(
  text: string,
  charPrIDRef: string,
  paraPrIDRef: string,
  horzsize: number,
  opts?: {
    vertsize?: number;
    spacing?: number;
    vertpos?: number;
    styleIDRef?: string;
  },
): string {
  const vs = opts?.vertsize ?? 1000;
  const sp = opts?.spacing ?? 300;
  const vp = opts?.vertpos ?? 0;
  const sid = opts?.styleIDRef ?? "0";
  const runContent = text ? `<hp:t>${escXml(text)}</hp:t>` : "";
  return (
    `<hp:p id="2147483648" paraPrIDRef="${paraPrIDRef}" styleIDRef="${sid}"` +
    ` pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${charPrIDRef}">${runContent}</hp:run>` +
    lineseg(horzsize, vs, sp, vp) +
    "</hp:p>"
  );
}

// ── 데이터 행 셀 span 매핑 ─────────────────────────────
// col0(1), col1(1), col2-3(2), col4(1), col5-6(2), col7(1), col8-9(2), col10(1), col11(1)
const DATA_CELL_DEFS = [
  { colAddr: 0, colSpan: 1, width: 3229 }, // ⑤번호
  { colAddr: 1, colSpan: 1, width: 4640 }, // ⑥발생일
  { colAddr: 2, colSpan: 2, width: 4641 }, // ⑦신청일
  { colAddr: 4, colSpan: 1, width: 5489 }, // ⑧성명
  { colAddr: 5, colSpan: 2, width: 8031 }, // ⑨사유
  { colAddr: 7, colSpan: 1, width: 6050 }, // ⑩입실시간
  { colAddr: 8, colSpan: 2, width: 5769 }, // ⑪퇴실시간
  { colAddr: 10, colSpan: 1, width: 4922 }, // ⑫훈련생서명
  { colAddr: 11, colSpan: 1, width: 4687 }, // ⑬관리자서명
] as const;

// ── 페이지 테이블 생성 (27행) ─────────────────────────
function buildPageTable(
  tableId: number,
  zOrder: number,
  config: DocConfig,
  records: (ExcuseRecord | undefined)[],
  _pageIndex: number,
  startNum: number,
  hasSignatureImage: boolean,
  imageId: string,
): string {
  const rows: string[] = [];
  const FULL_WIDTH = 47458;
  const INNER_WIDTH = 47176; // 셀 내부 콘텐츠 폭

  // Row 0: 법령 제목 (전체 span 12)
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 0,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 2191,
        borderFillIDRef: "12",
        content: textP(
          "\u25A0 \uD604\uC7A5 \uC2E4\uBB34\uC778\uC7AC \uC591\uC131\uC744 \uC704\uD55C" +
            " \uC9C1\uC5C5\uB2A5\uB825\uAC1C\uBC1C\uD6C8\uB828 \uC6B4\uC601\uADDC\uC815" +
            " [\uBCC4\uC9C0 \uC81C14\uD638 \uC11C\uC2DD]",
          "10",
          "33",
          INNER_WIDTH,
          { vertsize: 1000, spacing: 1300 },
        ),
      }) +
      "</hp:tr>",
  );

  // Row 1: 출석입력요청대장 (제목)
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 1,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 2446,
        borderFillIDRef: "13",
        content: textP(
          "\uCD9C\uC11D\uC785\uB825\uC694\uCCAD\uB300\uC7A5",
          "21",
          "45",
          INNER_WIDTH,
          { vertsize: 1600, spacing: 0, styleIDRef: "36" },
        ),
      }) +
      "</hp:tr>",
  );

  // Row 2: 빈 구분선
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 2,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 1080,
        borderFillIDRef: "14",
        content: textP("", "25", "40", INNER_WIDTH, { vertsize: 800, spacing: 1040 }),
      }) +
      "</hp:tr>",
  );

  // Row 3: 기관명
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 3,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 2329,
        borderFillIDRef: "15",
        content: textP(
          "\u33A9\uBAA8\uB450\uC758\uC5F0\uAD6C\uC18C",
          "17",
          "8",
          INNER_WIDTH,
        ),
      }) +
      "</hp:tr>",
  );

  // Row 4: ①훈련과정명 / 값 / ②훈련기간(회차) / 값
  const periodStr = `${config.periodStart} ~ ${config.periodEnd}`;
  const cohortStr = `(${config.cohort}\uD68C\uCC28)`;
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 4,
        colSpan: 3,
        width: 8738,
        height: 2663,
        borderFillIDRef: "16",
        content: textP(
          "\u2460\uD6C8\uB828\uACFC\uC815\uBA85",
          "17",
          "41",
          6456,
          { spacing: 100 },
        ),
      }) +
      buildCell({
        colAddr: 3,
        rowAddr: 4,
        colSpan: 3,
        width: 14967,
        height: 2663,
        borderFillIDRef: "17",
        content: textP(config.courseName, "17", "55", 14684),
      }) +
      buildCell({
        colAddr: 6,
        rowAddr: 4,
        colSpan: 3,
        width: 8941,
        height: 2663,
        borderFillIDRef: "17",
        content:
          textP("\u2461\uD6C8\uB828\uAE30\uAC04", "17", "41", 6660, { spacing: 100 }) +
          textP("(\uD68C\uCC28)", "17", "56", 6660, { spacing: 100, vertpos: 1100 }),
      }) +
      buildCell({
        colAddr: 9,
        rowAddr: 4,
        colSpan: 3,
        width: 14812,
        height: 2663,
        borderFillIDRef: "18",
        content:
          textP(periodStr, "17", "55", 14532) +
          textP(cohortStr, "17", "55", 14532, { vertpos: 1300 }),
      }) +
      "</hp:tr>",
  );

  // Row 5: ③훈련시간 / 값 / ④대장관리자 / 값
  const timeStr = `${config.timeStart} ~ ${config.timeEnd}`;
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 5,
        colSpan: 3,
        width: 8738,
        height: 2412,
        borderFillIDRef: "19",
        content: textP(
          "\u2462\uD6C8\uB828\uC2DC\uAC04",
          "17",
          "41",
          6456,
          { spacing: 100 },
        ),
      }) +
      buildCell({
        colAddr: 3,
        rowAddr: 5,
        colSpan: 3,
        width: 14967,
        height: 2412,
        borderFillIDRef: "20",
        content: textP(timeStr, "17", "55", 14684),
      }) +
      buildCell({
        colAddr: 6,
        rowAddr: 5,
        colSpan: 3,
        width: 8941,
        height: 2412,
        borderFillIDRef: "20",
        content: textP(
          "\u2463\uB300\uC7A5\uAD00\uB9AC\uC790",
          "17",
          "41",
          6660,
          { spacing: 100 },
        ),
      }) +
      buildCell({
        colAddr: 9,
        rowAddr: 5,
        colSpan: 3,
        width: 14812,
        height: 2412,
        borderFillIDRef: "21",
        content: textP(config.managerName, "17", "8", 14532),
      }) +
      "</hp:tr>",
  );

  // Row 6: 빈 구분선
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 6,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 631,
        borderFillIDRef: "5",
        content: textP("", "18", "35", INNER_WIDTH, { vertsize: 100, spacing: 0 }),
      }) +
      "</hp:tr>",
  );

  // Row 7: 컬럼 헤더 행
  const colHeaders = [
    {
      label: ["\u2464\uC77C\uB828", "  \uBC88\uD638"],
      addr: 0, span: 1, w: 3229, bdr: "8", hz: 2948,
    },
    {
      label: ["\u2465\uBC1C\uC0DD\uC77C"],
      addr: 1, span: 1, w: 4640, bdr: "9", hz: 4360,
    },
    {
      label: ["\u2466\uC2E0\uCCAD\uC77C"],
      addr: 2, span: 2, w: 4641, bdr: "9", hz: 4360,
    },
    {
      label: ["\u2467\uD6C8\uB828\uC0DD", "  \uC131  \uBA85"],
      addr: 4, span: 1, w: 5489, bdr: "9", hz: 5208,
    },
    {
      label: ["\u2468\uC0AC  \uC720"],
      addr: 5, span: 2, w: 8031, bdr: "9", hz: 7748,
    },
    {
      label: ["\u2469\uC785\uC2E4\uC2DC\uAC04", "  (\uC678\uCD9C\uC2DC\uAC04)"],
      addr: 7, span: 1, w: 6050, bdr: "9", hz: 5768,
    },
    {
      label: ["\u246A\uD1F4\uC2E4\uC2DC\uAC04", "  (\uADC0\uC6D0\uC2DC\uAC04)"],
      addr: 8, span: 2, w: 5769, bdr: "9", hz: 5488,
    },
    {
      label: ["\u246B\uD6C8\uB828\uC0DD", "  \uC11C  \uBA85"],
      addr: 10, span: 1, w: 4922, bdr: "9", hz: 4640,
    },
    {
      label: ["\u246C\uAD00\uB9AC\uC790", "  \uC11C  \uBA85"],
      addr: 11, span: 1, w: 4687, bdr: "10", hz: 4404,
    },
  ];

  let headerCells = "";
  for (const h of colHeaders) {
    let pContent = "";
    for (let li = 0; li < h.label.length; li++) {
      pContent += textP(h.label[li], "17", "8", h.hz, { vertpos: li * 1300 });
    }
    headerCells += buildCell({
      colAddr: h.addr,
      rowAddr: 7,
      colSpan: h.span,
      width: h.w,
      height: 3429,
      borderFillIDRef: h.bdr,
      content: pContent,
    });
  }
  rows.push(`<hp:tr>${headerCells}</hp:tr>`);

  // Rows 8-22: 데이터 행 (15행)
  for (let i = 0; i < ROWS_PER_PAGE; i++) {
    const rowIdx = 8 + i;
    const rec = records[i];
    const rowNum = rec ? String(startNum + i) : "";

    const values = rec
      ? [
          rowNum,
          rec.occurrenceDate,
          rec.applicationDate,
          rec.traineeName,
          rec.reason,
          rec.checkinTime,
          rec.checkoutTime,
          "\uBE44\uB300\uBA74", // 훈련생 서명: "비대면"
          "", // 관리자 서명: 이미지 or 빈칸
        ]
      : ["", "", "", "", "", "", "", "", ""];

    let dataCells = "";
    for (let ci = 0; ci < DATA_CELL_DEFS.length; ci++) {
      const def = DATA_CELL_DEFS[ci];
      const isFirstCol = ci === 0;
      const isLastCol = ci === DATA_CELL_DEFS.length - 1;
      const bdrRef = isFirstCol ? "11" : isLastCol ? "7" : "6";
      // paraPrIDRef: 번호/이름/입실/퇴실/서명 = 57, 날짜/사유 = 35
      const prId =
        ci === 0 || ci === 3 || ci === 5 || ci === 6 || ci === 7 || ci === 8
          ? "57"
          : "35";
      // charPrIDRef: 사유 칼럼(ci=4) = 30, 나머지 = 17
      const charRef = ci === 4 ? "30" : "17";

      // 관리자 서명 셀: 데이터가 있으면 이미지 또는 빈칸
      let cellContent: string;
      if (isLastCol && rec && hasSignatureImage) {
        cellContent = buildSignatureImageP(imageId, def.width, 2310);
      } else {
        cellContent = textP(values[ci], charRef, prId, def.width - 284, {
          spacing: 0,
        });
      }

      dataCells += buildCell({
        colAddr: def.colAddr,
        rowAddr: rowIdx,
        colSpan: def.colSpan,
        width: def.width,
        height: 2310,
        borderFillIDRef: bdrRef,
        hasMargin: true,
        lineWrap: "BREAK",
        content: cellContent,
      });
    }
    rows.push(`<hp:tr>${dataCells}</hp:tr>`);
  }

  // Row 23: 빈 구분선
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 23,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 631,
        borderFillIDRef: "22",
        content: textP("", "18", "35", INNER_WIDTH, { vertsize: 100, spacing: 0 }),
      }) +
      "</hp:tr>",
  );

  // Row 24: 작성요령 헤더
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 24,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 1567,
        borderFillIDRef: "23",
        lineWrap: "BREAK",
        content: textP(
          "\uC791\uC131\uC694\uB839",
          "12",
          "38",
          45676,
          { vertsize: 900, spacing: 540, styleIDRef: "38" },
        ),
      }) +
      "</hp:tr>",
  );

  // Row 25: 작성요령 내용
  const notes = buildFooterNotes();
  let notesPContent = "";
  for (let ni = 0; ni < notes.length; ni++) {
    const prId =
      ni === 0 ? "34" : ni === notes.length - 1 ? "34" : ni <= 1 ? "42" : "43";
    if (ni === notes.length - 1) {
      notesPContent +=
        `<hp:p id="2147483648" paraPrIDRef="${prId}" styleIDRef="0"` +
        ` pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="19"><hp:t>${escXml(notes[ni])}</hp:t></hp:run>` +
        `<hp:run charPrIDRef="13"/>` +
        lineseg(INNER_WIDTH, 800, 640, ni * 1440) +
        "</hp:p>";
    } else {
      notesPContent +=
        `<hp:p id="2147483648" paraPrIDRef="${prId}" styleIDRef="0"` +
        ` pageBreak="0" columnBreak="0" merged="0">` +
        `<hp:run charPrIDRef="19"><hp:t>${escXml(notes[ni])}</hp:t></hp:run>` +
        (ni === 0 ? '<hp:run charPrIDRef="25"/>' : "") +
        lineseg(INNER_WIDTH, 800, 640, ni * 1440) +
        "</hp:p>";
    }
  }
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 25,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 16333,
        borderFillIDRef: "24",
        lineWrap: "BREAK",
        content: notesPContent,
      }) +
      "</hp:tr>",
  );

  // Row 26: 하단 구분선
  rows.push(
    "<hp:tr>" +
      buildCell({
        colAddr: 0,
        rowAddr: 26,
        colSpan: 12,
        width: FULL_WIDTH,
        height: 514,
        borderFillIDRef: "25",
        hasMargin: true,
        lineWrap: "BREAK",
        content: textP("", "20", "34", INNER_WIDTH, { vertsize: 100, spacing: 80 }),
      }) +
      "</hp:tr>",
  );

  // 테이블 래퍼
  return (
    `<hp:tbl id="${tableId}" zOrder="${zOrder}" numberingType="TABLE"` +
    ` textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0"` +
    ` dropcapstyle="None" pageBreak="NONE" repeatHeader="1"` +
    ` rowCnt="27" colCnt="12" cellSpacing="0" borderFillIDRef="3" noAdjust="0">` +
    `<hp:sz width="${FULL_WIDTH}" widthRelTo="ABSOLUTE"` +
    ` height="70876" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1"' +
    ' allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA"' +
    ' horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT"' +
    ' vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="140" right="140" top="140" bottom="140"/>' +
    '<hp:inMargin left="140" right="140" top="140" bottom="140"/>' +
    rows.join("") +
    "</hp:tbl>"
  );
}

// ── 작성요령 주석 텍스트 ───────────────────────────────
function buildFooterNotes(): string[] {
  return [
    "  1. \uB300\uC7A5\uC740 \uD6C8\uB828\uAE30\uAD00\uC5D0\uC11C \uC804\uB2F4\uC790\uB97C" +
      " \uB450\uC5B4 \uBCC4\uB3C4 \uC791\uC131\u2027\uAD00\uB9AC\uD558\uC5EC\uC57C \uD558\uACE0," +
      " \uD6C8\uB828\uC0DD\uC740 \uC0AC\uC720\uBC1C\uC0DD\uC77C \uB2F9\uC77C\uC5D0" +
      " \uD6C8\uB828\uC774 \uC885\uB8CC\uB41C \uC774\uD6C4 \uAD00\uB9AC\uC790\uAC00" +
      " \uAE30\uC7AC\uD55C \uB0B4\uC6A9\uC744 \uD655\uC778\uD55C \uD6C4 \uD6C8\uB828\uC0DD\uC774" +
      " \uC9C1\uC811 \uBCF8\uC778\uC758 \uC131\uBA85\uC744 \uC790\uD544\uB85C \uC815\uD655\uD558\uAC8C" +
      " \uC791\uC131(\uC0AC\uC778, \uD2B9\uC218\uBB38\uC790 \uB4F1\uC740 \uAE30\uC7AC\uD560 \uC218 \uC5C6\uC74C )",
    "    1) \u2465\uB780\uC758 \uBC1C\uC0DD\uC77C\uC790\uB294 \uC9C1\uAD8C\uC785\uB825\uC0AC\uC720" +
      " \uBC1C\uC0DD \uD574\uB2F9\uC77C\uC790\uB97C \uAE30\uC7AC",
    "    2) \u2467\uB780\uC758 \uD6C8\uB828\uC0DD \uC131\uBA85\uC740 \uD6C8\uB828\uAE30\uAD00\uC758" +
      " \uC804\uB2F4\uAD00\uB9AC\uC790\uAC00 \uC9C1\uC811 \uAE30\uC7AC",
    "    3) \u2468\uB780\uC758 \uC0AC\uC720\uB294 '\uCE74\uB4DC \uBD84\uC2E4\u3161\uD6FC\uC190'," +
      " '\uC815\uC804', '\uB2E8\uB9D0\uAE30 \uACE0\uC7A5', '\uCE74\uB4DC\uBC1C\uAE09 \uC9C0\uC5F0'" +
      "\uB4F1 \uC9C1\uAD8C\uC785\uB825 \uC0AC\uC720\uB97C \uAE30\uC7AC",
    "        \uAD50\uB300\uADFC\uBB34\uC790\uC5D0 \uB300\uD574 \uD6C8\uB828\uC2DC\uAC04 \uBCC0\uACBD\uC744" +
      " \uD5C8\uC6A9\uD55C \uACBD\uC6B0, \uBCC0\uACBD\uD55C \uD6C8\uB828\uACFC\uC815\uBA85 \uBC0F" +
      " \uC218\uAC15\uC77C\u3161\uC218\uAC15\uC2DC\uAC04\uB3C4 \uD568\uAED8 \uAE30\uC7AC",
    "    4) \u2469\uB780\uC758 \uC785\uC2E4\uC2DC\uAC04\uC740 \uC9C1\uAD8C\uC0AC\uC720\uAC00" +
      " \uBC1C\uC0DD\uD55C \uD6C8\uB828\uC0DD\uC758 \uC785\uC2E4(\uC678\uCD9C)\uC2DC\uAC04\uC744 \uAE30\uC7AC",
    "    5) \u246A\uB780\uC758 \uD1F4\uC2E4\uC2DC\uAC04\uC740 \uC9C1\uAD8C\uC0AC\uC720\uAC00" +
      " \uBC1C\uC0DD\uD55C \uD6C8\uB828\uC0DD\uC758 \uD1F4\uC2E4(\uADC0\uC6D0)\uC2DC\uAC04\uC744 \uAE30\uC7AC ",
    "    6) \u246B\uB780\uC758 \uD6C8\uB828\uC0DD \uC11C\uBA85\uC740 \uC9C1\uAD8C\uC0AC\uC720\uAC00" +
      " \uBC1C\uC0DD\uD55C \uD6C8\uB828\uC0DD\uC774 \uBCF8\uC778\uC758 \uC774\uB984\uC744" +
      " \uC790\uD544\uB85C \uC815\uC790\uB85C \uAE30\uC7AC ",
    "    7) \u246C\uB780\uC758 \uAD00\uB9AC\uC790 \uC11C\uBA85\uC740 \uAD00\uB9AC\uC790\uAC00" +
      " \uC790\uD544\uB85C \uD655\uC778 \uC11C\uBA85(\uB300\uC7A5\uAD00\uB9AC\uC790\uAC00 \uC9C1\uC811 \uC11C\uBA85)",
    "  2. \uCD9C\uC11D\uC785\uB825 \uC2E0\uCCAD\uC740 \uD574\uB2F9 \uC0AC\uC720\uAC00 \uBC1C\uC0DD\uD55C" +
      " \uB0A0\uC758 \uB2E4\uC74C \uB0A0\uAE4C\uC9C0 HRD-Net\uC744 \uD1B5\uD574 \uC2E0\uCCAD \uAC00\uB2A5",
  ];
}

// ── 관리자 서명 인라인 이미지 ──────────────────────────
function buildSignatureImageP(
  imageId: string,
  cellWidth: number,
  _cellHeight: number,
): string {
  const imgWidth = Math.min(3790, cellWidth - 400);
  const imgHeight = 1929;
  const cx = Math.round(imgWidth / 2);
  const cy = Math.round(imgHeight / 2);
  return (
    '<hp:p id="2147483648" paraPrIDRef="57" styleIDRef="0"' +
    ' pageBreak="0" columnBreak="0" merged="0">' +
    '<hp:run charPrIDRef="3">' +
    `<hp:pic id="0" zOrder="0" numberingType="PICTURE"` +
    ` textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0"` +
    ` dropcapstyle="None" href="" groupLevel="0" instid="0" reverse="0">` +
    '<hp:offset x="0" y="0"/>' +
    `<hp:orgSz width="${imgWidth}" height="${imgHeight}"/>` +
    `<hp:curSz width="${imgWidth}" height="${imgHeight}"/>` +
    '<hp:flip horizontal="0" vertical="0"/>' +
    `<hp:rotationInfo angle="0" centerX="${cx}" centerY="${cy}" rotateimage="1"/>` +
    "<hp:renderingInfo>" +
    '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
    '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
    '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>' +
    "</hp:renderingInfo>" +
    `<hc:img binaryItemIDRef="${imageId}" bright="0" contrast="0"` +
    ` effect="REAL_PIC" alpha="0"/>` +
    "<hp:imgRect>" +
    '<hc:pt0 x="0" y="0"/>' +
    `<hc:pt1 x="${imgWidth}" y="0"/>` +
    `<hc:pt2 x="${imgWidth}" y="${imgHeight}"/>` +
    `<hc:pt3 x="0" y="${imgHeight}"/>` +
    "</hp:imgRect>" +
    '<hp:imgClip left="0" right="0" top="0" bottom="0"/>' +
    '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
    `<hp:imgDim dimwidth="${imgWidth}" dimheight="${imgHeight}"/>` +
    "<hp:effects/>" +
    `<hp:sz width="${imgWidth}" widthRelTo="ABSOLUTE"` +
    ` height="${imgHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1"' +
    ' allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA"' +
    ' horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT"' +
    ' vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
    "</hp:pic>" +
    "<hp:t/>" +
    "</hp:run>" +
    lineseg(cellWidth - 284, imgHeight, 0) +
    "</hp:p>"
  );
}

// ── section0.xml 전체 생성 ─────────────────────────────
function buildSectionXml(
  config: DocConfig,
  records: ExcuseRecord[],
  hasSignatureImage: boolean,
  imageId: string,
): string {
  const pageCount = Math.max(1, Math.ceil(records.length / ROWS_PER_PAGE));
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

  // secPr: 페이지 설정 (A4 세로, 여백)
  const secPrXml =
    '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134"' +
    ' tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT"' +
    ' outlineShapeIDRef="0" memoShapeIDRef="0"' +
    ' textVerticalWidthHead="0" masterPageCnt="0">' +
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
    '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
    '<hp:visibility hideFirstHeader="0" hideFirstFooter="0"' +
    ' hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL"' +
    ' hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
    '<hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">' +
    '<hp:margin header="2834" footer="2834" gutter="0"' +
    ' left="5669" right="5669" top="4251" bottom="4251"/>' +
    "</hp:pagePr>" +
    "<hp:footNotePr>" +
    '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
    '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#A10FCA0"/>' +
    '<hp:noteSpacing betweenNotes="284" belowLine="568" aboveLine="852"/>' +
    '<hp:numbering type="CONTINUOUS" newNum="2720"/>' +
    '<hp:placement place="EACH_COLUMN" beneathText="0"/>' +
    "</hp:footNotePr>" +
    "<hp:endNotePr>" +
    '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
    '<hp:noteLine length="0" type="NONE" width="0.12 mm" color="#A8808A1"/>' +
    '<hp:noteSpacing betweenNotes="0" belowLine="576" aboveLine="864"/>' +
    '<hp:numbering type="CONTINUOUS" newNum="2721"/>' +
    '<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>' +
    "</hp:endNotePr>" +
    '<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER"' +
    ' headerInside="0" footerInside="0" fillArea="PAPER">' +
    '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>' +
    "</hp:pageBorderFill>" +
    '<hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER"' +
    ' headerInside="0" footerInside="0" fillArea="PAPER">' +
    '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>' +
    "</hp:pageBorderFill>" +
    '<hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER"' +
    ' headerInside="0" footerInside="0" fillArea="PAPER">' +
    '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>' +
    "</hp:pageBorderFill>" +
    "</hp:secPr>";

  const parts: string[] = [];

  // 첫 페이지 레코드 (15행, 부족하면 빈 행)
  const firstPageRecords: (ExcuseRecord | undefined)[] = records.slice(0, ROWS_PER_PAGE);
  while (firstPageRecords.length < ROWS_PER_PAGE) {
    firstPageRecords.push(undefined);
  }

  const firstTable = buildPageTable(
    1307417828,
    0,
    config,
    firstPageRecords,
    0,
    1,
    hasSignatureImage,
    imageId,
  );

  // 첫 문단: secPr + 페이지번호 + 첫 테이블
  parts.push(
    '<hp:p id="0" paraPrIDRef="52" styleIDRef="0"' +
      ' pageBreak="0" columnBreak="0" merged="0">' +
      `<hp:run charPrIDRef="5">${secPrXml}` +
      '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT"' +
      ' colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>' +
      "</hp:run>" +
      '<hp:run charPrIDRef="5">' +
      '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>' +
      "</hp:run>" +
      `<hp:run charPrIDRef="10">${firstTable}<hp:t/></hp:run>` +
      "<hp:linesegarray>" +
      '<hp:lineseg textpos="0" vertpos="0" vertsize="71156"' +
      ' textheight="71156" baseline="60483" spacing="840"' +
      ' horzpos="0" horzsize="48188" flags="393216"/>' +
      "</hp:linesegarray>" +
      "</hp:p>",
  );

  // 추가 페이지들
  for (let page = 1; page < pageCount; page++) {
    const start = page * ROWS_PER_PAGE;
    const pageRecords: (ExcuseRecord | undefined)[] = records.slice(
      start,
      start + ROWS_PER_PAGE,
    );
    while (pageRecords.length < ROWS_PER_PAGE) {
      pageRecords.push(undefined);
    }

    const tableId = 1307417828 + page * 100000;
    const zOrder = page * 2 + 1;

    const table = buildPageTable(
      tableId,
      zOrder,
      config,
      pageRecords,
      page,
      start + 1,
      hasSignatureImage,
      imageId,
    );

    parts.push(
      '<hp:p id="0" paraPrIDRef="7" styleIDRef="0"' +
        ' pageBreak="0" columnBreak="0" merged="0">' +
        `<hp:run charPrIDRef="11">${table}<hp:t/></hp:run>` +
        "<hp:linesegarray>" +
        '<hp:lineseg textpos="0" vertpos="0" vertsize="71156"' +
        ' textheight="71156" baseline="60483" spacing="840"' +
        ' horzpos="0" horzsize="48188" flags="393216"/>' +
        "</hp:linesegarray>" +
        "</hp:p>",
    );
  }

  return `${xmlDecl}<hs:sec ${XMLNS_ATTRS}>${parts.join("")}</hs:sec>`;
}

// ── content.hpf (매니페스트) 생성 ──────────────────────
function buildContentHpf(hasSignatureImage: boolean, imageId: string): string {
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  let manifestItems =
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
    '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>';

  if (hasSignatureImage) {
    manifestItems +=
      `<opf:item id="${imageId}" href="BinData/${imageId}.png"` +
      ` media-type="image/png" isEmbeded="1"/>`;
  }

  return (
    xmlDecl +
    `<opf:package ${XMLNS_ATTRS} version="" unique-identifier="" id="">` +
    "<opf:metadata>" +
    "<opf:title>\uCD9C\uC11D\uC785\uB825\uC694\uCCAD\uB300\uC7A5</opf:title>" +
    "<opf:language>ko</opf:language>" +
    '<opf:meta name="creator" content="text">KDT Dashboard</opf:meta>' +
    '<opf:meta name="subject" content="text">' +
    "\uCD9C\uC11D\uC785\uB825\uC694\uCCAD\uB300\uC7A5</opf:meta>" +
    '<opf:meta name="description" content="text">' +
    "KDT \uD559\uC0AC\uC77C\uC815\uAD00\uB9AC \uB300\uC2DC\uBCF4\uB4DC\uC5D0\uC11C" +
    " \uC790\uB3D9 \uC0DD\uC131\uB41C \uBB38\uC11C\uC785\uB2C8\uB2E4.</opf:meta>" +
    '<opf:meta name="lastsaveby" content="text">KDT Dashboard</opf:meta>' +
    `<opf:meta name="CreatedDate" content="text">${now}</opf:meta>` +
    `<opf:meta name="ModifiedDate" content="text">${now}</opf:meta>` +
    "</opf:metadata>" +
    `<opf:manifest>${manifestItems}</opf:manifest>` +
    "<opf:spine>" +
    '<opf:itemref idref="header" linear="yes"/>' +
    '<opf:itemref idref="section0" linear="yes"/>' +
    "</opf:spine>" +
    "</opf:package>"
  );
}

// ── settings.xml (최소) ────────────────────────────────
const SETTINGS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  `<ha:HWPApplicationSetting ${XMLNS_ATTRS}>` +
  '<ha:caretPosition list="0" para="0" pos="0"/>' +
  "</ha:HWPApplicationSetting>";

// ── PNG base64 DataURL -> Uint8Array ───────────────────
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── 다운로드 트리거 ────────────────────────────────────
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 메인 엔트리 ────────────────────────────────────────
/**
 * HWPX 파일 생성 및 다운로드
 *
 * @param config 과정 설정 (과정명, 기간, 관리자 등)
 * @param records 공결 기록 배열
 * @param filename 다운로드 파일명 (기본: 출석입력요청대장_YYYY-MM-DD.hwpx)
 */
export async function generateHwpx(
  config: DocConfig,
  records: ExcuseRecord[],
  filename?: string,
): Promise<void> {
  const hasSignatureImage = !!config.signatureData;
  const imageId = "image1";

  // header.xml 디코딩 (gzip base64 -> XML 문자열)
  const headerXml = HEADER_XML_RAW;

  // section0.xml 동적 생성
  const sectionXml = buildSectionXml(config, records, hasSignatureImage, imageId);

  // content.hpf 매니페스트 생성
  const contentHpf = buildContentHpf(hasSignatureImage, imageId);

  // ZIP 패키징
  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE_CONTENT, { compression: "STORE" });
  zip.file("version.xml", VERSION_XML);
  zip.file("Contents/content.hpf", contentHpf);
  zip.file("Contents/header.xml", headerXml);
  zip.file("Contents/section0.xml", sectionXml);
  zip.file("settings.xml", SETTINGS_XML);

  // 서명 이미지 추가
  if (hasSignatureImage) {
    const sigBytes = dataUrlToUint8Array(config.signatureData);
    zip.file(`BinData/${imageId}.png`, sigBytes);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/hwp+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const defaultName =
    "\uCD9C\uC11D\uC785\uB825\uC694\uCCAD\uB300\uC7A5_" +
    new Date().toISOString().slice(0, 10) +
    ".hwpx";
  downloadBlob(blob, filename ?? defaultName);
}

/**
 * HWPX Blob 반환 (다운로드 없이)
 * 테스트 또는 프리뷰용
 */
export async function generateHwpxBlob(
  config: DocConfig,
  records: ExcuseRecord[],
): Promise<Blob> {
  const hasSignatureImage = !!config.signatureData;
  const imageId = "image1";

  const headerXml = HEADER_XML_RAW;
  const sectionXml = buildSectionXml(config, records, hasSignatureImage, imageId);
  const contentHpf = buildContentHpf(hasSignatureImage, imageId);

  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE_CONTENT, { compression: "STORE" });
  zip.file("version.xml", VERSION_XML);
  zip.file("Contents/content.hpf", contentHpf);
  zip.file("Contents/header.xml", headerXml);
  zip.file("Contents/section0.xml", sectionXml);
  zip.file("settings.xml", SETTINGS_XML);

  if (hasSignatureImage) {
    const sigBytes = dataUrlToUint8Array(config.signatureData);
    zip.file(`BinData/${imageId}.png`, sigBytes);
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/hwp+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
