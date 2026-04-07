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

// ── header.xml (gzip + base64 인코딩) ──────────────────
// 원본 한컴오피스 HWPX의 전체 header.xml을 gzip 압축 후 base64 인코딩
// charPr, paraPr, borderFill, fontface 등 모든 스타일 정의 포함
const HEADER_XML_GZ_B64 =
  "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";

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

// ── base64 디코딩 + gzip 풀기 ──────────────────────────
async function decodeGzipBase64(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // DecompressionStream API (모든 최신 브라우저 지원)
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8").decode(result);
}

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
  const headerXml = await decodeGzipBase64(HEADER_XML_GZ_B64);

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

  const headerXml = await decodeGzipBase64(HEADER_XML_GZ_B64);
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
