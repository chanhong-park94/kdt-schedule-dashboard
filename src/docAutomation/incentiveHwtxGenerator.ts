/**
 * 장려금 수급여부 확인서 HWTX 생성 엔진
 *
 * 청년수당, 산재휴업급여 등 수급 여부 확인서 양식을 자동 생성합니다.
 * 원본 HWTX 템플릿의 header.xml을 재사용하고 section0.xml을 동적 생성합니다.
 */
import JSZip from "jszip";
import type { IncentiveConfig, IncentiveRecord } from "./docAutomationApi";
import INCENTIVE_HEADER_RAW from "./template/incentive-header.xml?raw";

// ── 상수 ──────────────────────────────────────────
const MIMETYPE = "application/hwp+zip";

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

const XMLNS = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join(" ");

const VERSION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"' +
  ' tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1"' +
  ' buildNumber="0" os="1" xmlVersion="1.5"' +
  ' application="Hancom Office Hangul" appVersion="13, 0, 0, 564 WIN32LEWindows_10"/>';

const SETTINGS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  `<ha:HWPApplicationSetting ${XMLNS}>` +
  '<ha:caretPosition list="0" para="0" pos="0"/>' +
  "</ha:HWPApplicationSetting>";

// ── XML 헬퍼 ──────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 단순 텍스트 paragraph */
function p(text: string, charPr = "0", paraPr = "0"): string {
  return `<hp:p paraPrIDRef="${paraPr}"><hp:run charPrIDRef="${charPr}"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;
}

/** 빈 paragraph */
function emptyP(paraPr = "0"): string {
  return `<hp:p paraPrIDRef="${paraPr}"><hp:run charPrIDRef="0"/></hp:p>`;
}

/** 테이블 셀 (텍스트) */
function tc(text: string, width: number, borderFill = "2", charPr = "0", paraPr = "0"): string {
  const hasText = text.trim() !== "";
  return (
    `<hp:tc borderFillIDRef="${borderFill}" width="${width}">` +
    `<hp:cellAddr colAddr="0" rowAddr="0"/>` +
    `<hp:cellSpan colSpan="1" rowSpan="1"/>` +
    `<hp:cellSz width="${width}" height="0"/>` +
    `<hp:cellMargin left="100" right="100" top="50" bottom="50"/>` +
    `<hp:subList>` +
    `<hp:p paraPrIDRef="${paraPr}">` +
    `<hp:run charPrIDRef="${charPr}">` +
    (hasText ? `<hp:t>${esc(text)}</hp:t>` : "") +
    `</hp:run></hp:p></hp:subList></hp:tc>`
  );
}

// ── Section XML 생성 ──────────────────────────────
function buildSectionXml(config: IncentiveConfig, records: IncentiveRecord[]): string {
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

  // 컬럼 너비 (HWP 단위, 총합 ≈ 42520)
  const COL = {
    num: 1800,       // 연번
    name: 3400,      // 성명
    birth: 4000,     // 생년월일
    jobSeek: 2400,   // 국취참여
    employed: 3200,  // 취업여부
    unemp: 2400,     // 실업급여수급
    youth: 2400,     // 청년수당수급
    biz: 2400,       // 사업자등록
    amount: 3800,    // 훈련장려금
    sign: 3600,      // 서명
    note: 4800,      // 비고
  };

  // 날짜 파싱
  const docDate = config.docDate || new Date().toISOString().slice(0, 10);
  const [yyyy, mm, dd] = docDate.split("-");

  // 총 합계
  const totalAmount = records.reduce((s, r) => s + r.incentiveAmount, 0);

  // ── 본문 구성 시작
  let body = "";

  // 제목
  body += p("청년수당, 산재휴업급여 등 수급 여부 확인서", "1", "1");
  body += emptyP();

  // 과정 정보
  body += p(`○ 훈련기관명: ㈜모두의연구소`, "0", "0");
  body += emptyP();
  body += p(`○ 훈련과정명 / 회차 : ${config.courseName}`, "0", "0");
  body += emptyP();
  body += p(`○ 훈련기간(단위기간) : ${config.trainingPeriod} (${config.unitPeriod})`, "0", "0");
  body += emptyP();

  // 안내 문구
  body += p("‣ 국민내일배움카드 운영규정에 의거하여 훈련장려금 지급 이후 취업상태(근로제공)임이 확인될 경우 지급 받은 훈련장려금을 환수함에 동의합니다.", "0", "0");
  body += emptyP();
  body += p("‣ 또한 아래와 같이 청년구직활동지원금, 서울시 청년수당 등 구직활동지원 목적의 수당을 지급받는 경우 훈련장려금 지급이 중단될 수 있으니 확인하여주시기 바랍니다.", "0", "0");
  body += emptyP();

  // ── 테이블
  const totalWidth = Object.values(COL).reduce((a, b) => a + b, 0);

  body += `<hp:tbl borderFillIDRef="1" cellSpacing="0" colCount="11" rowCount="${records.length + 2}">`;

  // 테이블 그리드
  body += "<hp:tableGrid>";
  Object.values(COL).forEach((w) => { body += `<hp:gridCol width="${w}"/>`; });
  body += "</hp:tableGrid>";

  // 헤더 행
  body += "<hp:tr>";
  body += tc("연\n번", COL.num, "3", "2", "2");
  body += tc("성명", COL.name, "3", "2", "2");
  body += tc("생년월일", COL.birth, "3", "2", "2");
  body += tc("국취\n참여", COL.jobSeek, "3", "2", "2");
  body += tc("취업여부\n(취업일,\n주근로시간)", COL.employed, "3", "2", "2");
  body += tc("실업\n급여\n수급", COL.unemp, "3", "2", "2");
  body += tc("청년\n수당\n수급", COL.youth, "3", "2", "2");
  body += tc("사업자\n등록", COL.biz, "3", "2", "2");
  body += tc("훈련\n장려금", COL.amount, "3", "2", "2");
  body += tc("서명\n(정자기재)", COL.sign, "3", "2", "2");
  body += tc("비고", COL.note, "3", "2", "2");
  body += "</hp:tr>";

  // 소제목 행 (해당사항 O 표기)
  body += "<hp:tr>";
  for (let c = 0; c < 11; c++) {
    const w = Object.values(COL)[c];
    body += tc(c === 0 ? "*해당사항 있을시 O 표기" : "", w, "2", "3", "0");
  }
  body += "</hp:tr>";

  // 데이터 행
  records.forEach((r, i) => {
    body += "<hp:tr>";
    body += tc(String(i + 1), COL.num, "2", "0", "2");
    body += tc(r.name, COL.name, "2", "0", "2");
    body += tc(r.birthDate, COL.birth, "2", "0", "2");
    body += tc(r.nationalJobSeeking, COL.jobSeek, "2", "0", "2");
    body += tc(r.employed, COL.employed, "2", "0", "2");
    body += tc(r.unemploymentBenefit, COL.unemp, "2", "0", "2");
    body += tc(r.youthAllowance, COL.youth, "2", "0", "2");
    body += tc(r.businessRegistered, COL.biz, "2", "0", "2");
    body += tc(r.incentiveAmount.toLocaleString(), COL.amount, "2", "0", "2");
    body += tc(r.signature, COL.sign, "2", "0", "2");
    body += tc(r.note, COL.note, "2", "0", "2");
    body += "</hp:tr>";
  });

  body += "</hp:tbl>";

  // 합계
  body += emptyP();
  body += p(`총 합계(총 ${records.length}명)    ${totalAmount.toLocaleString()}원`, "1", "0");
  body += emptyP();

  // 날짜 + 기관
  body += p(`${yyyy}년 ${Number(mm)}월 ${Number(dd)}일`, "0", "3");
  body += p("모두의연구소", "1", "3");

  // section XML 래핑
  return (
    xmlDecl +
    `<hs:sec ${XMLNS}>` +
    `<hs:secDef textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000"` +
    ` outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0">` +
    `<hs:startNum page="0" pic="0" tbl="0" equation="0"/>` +
    `<hs:pageDef landscape="NARROWLY" width="59528" height="84188" gutterType="LEFT_ONLY">` +
    `<hs:margin header="4252" footer="4252" left="8504" right="8504" top="5668" bottom="4252" gutter="0"/>` +
    `</hs:pageDef>` +
    `<hs:footNotePr>` +
    `<hs:autoNumFormat type="DIGIT" suffixChar=")" superscript="0"/>` +
    `<hs:noteLine length="-1" type="SOLID" width="0.12mm" color="#000000"/>` +
    `<hs:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>` +
    `<hs:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hs:placement place="EACH_COLUMN" beneathText="0"/>` +
    `</hs:footNotePr>` +
    `<hs:endNotePr>` +
    `<hs:autoNumFormat type="DIGIT" suffixChar=")" superscript="0"/>` +
    `<hs:noteLine length="14692308" type="SOLID" width="0.12mm" color="#000000"/>` +
    `<hs:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>` +
    `<hs:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hs:placement place="END_OF_DOCUMENT" beneathText="0"/>` +
    `</hs:endNotePr>` +
    `</hs:secDef>` +
    body +
    `</hs:sec>`
  );
}

// ── content.hpf ───────────────────────────────────
function buildContentHpf(): string {
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return (
    xmlDecl +
    `<opf:package ${XMLNS} version="" unique-identifier="" id="">` +
    "<opf:metadata>" +
    "<opf:title>\uC7A5\uB824\uAE08 \uC218\uAE09\uC5EC\uBD80 \uD655\uC778\uC11C</opf:title>" +
    "<opf:language>ko</opf:language>" +
    '<opf:meta name="creator" content="text">KDT Dashboard</opf:meta>' +
    `<opf:meta name="CreatedDate" content="text">${now}</opf:meta>` +
    `<opf:meta name="ModifiedDate" content="text">${now}</opf:meta>` +
    "</opf:metadata>" +
    "<opf:manifest>" +
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
    '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>' +
    "</opf:manifest>" +
    "<opf:spine>" +
    '<opf:itemref idref="header" linear="yes"/>' +
    '<opf:itemref idref="section0" linear="yes"/>' +
    "</opf:spine>" +
    "</opf:package>"
  );
}

// ── META-INF (HWPX/HWTX 필수 메타데이터) ─────────
const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"' +
  ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">' +
  "<ocf:rootfiles>" +
  '<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>' +
  '<ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/>' +
  "</ocf:rootfiles></ocf:container>";

const CONTAINER_RDF =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="">' +
  '<ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about="Contents/header.xml">' +
  '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about="">' +
  '<ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about="Contents/section0.xml">' +
  '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/>' +
  "</rdf:Description>" +
  '<rdf:Description rdf:about="">' +
  '<rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/>' +
  "</rdf:Description></rdf:RDF>";

const MANIFEST_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

// ── 다운로드 ──────────────────────────────────────
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

// ── 메인 엔트리 ───────────────────────────────────
export async function generateIncentiveHwtx(
  config: IncentiveConfig,
  records: IncentiveRecord[],
  filename?: string,
): Promise<void> {
  const sectionXml = buildSectionXml(config, records);
  const contentHpf = buildContentHpf();

  const zip = new JSZip();
  zip.file("mimetype", MIMETYPE, { compression: "STORE" });
  zip.file("version.xml", VERSION_XML);
  zip.file("Contents/content.hpf", contentHpf);
  zip.file("Contents/header.xml", INCENTIVE_HEADER_RAW);
  zip.file("Contents/section0.xml", sectionXml);
  zip.file("settings.xml", SETTINGS_XML);
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("META-INF/container.rdf", CONTAINER_RDF);
  zip.file("META-INF/manifest.xml", MANIFEST_XML);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const fname = filename || `장려금확인서_${new Date().toISOString().slice(0, 10)}.hwtx`;
  downloadBlob(blob, fname);
}
