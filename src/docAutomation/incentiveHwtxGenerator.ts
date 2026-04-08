/**
 * 장려금 수급여부 확인서 HWTX 생성 엔진
 *
 * 전략: 원본 HWTX의 section0.xml을 템플릿으로 사용하고,
 * 텍스트 노드만 치환하여 원본 서식(폰트, 테두리, 셀 크기)을 완벽히 유지.
 *
 * 원본 구조:
 *   - 헤더(과정정보) + 안내문구
 *   - 테이블: 헤더행(tr0) + 주석행(tr1) + 데이터행(tr2~29, 28행) + 합계행(tr30)
 *   - 날짜 + 기관명
 */
import JSZip from "jszip";
import type { IncentiveConfig, IncentiveRecord } from "./docAutomationApi";
import INCENTIVE_HEADER_RAW from "./template/incentive-header.xml?raw";
import INCENTIVE_SECTION0_RAW from "./template/incentive-section0.xml?raw";

const MIMETYPE = "application/hwp+zip";

// ── 원본 필수 XML 파일들 ──────────────────────────
const VERSION_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"' +
  ' tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1"' +
  ' buildNumber="0" os="1" xmlVersion="1.5"' +
  ' application="Hancom Office Hangul" appVersion="13, 0, 0, 564 WIN32LEWindows_10"/>';

const SETTINGS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">' +
  '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>' +
  "</ha:HWPApplicationSetting>";

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
  '<rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description>' +
  '<rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description>' +
  '<rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description>' +
  '<rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description>' +
  '<rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>';

const MANIFEST_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

// ── content.hpf ────────────────────────────────────
function buildContentHpf(): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const NS = 'xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    `<opf:package ${NS} version="" unique-identifier="" id="">` +
    "<opf:metadata>" +
    "<opf:title>HWP \uD30C\uC77C</opf:title>" +
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
    "</opf:spine></opf:package>"
  );
}

// ── 텍스트 치환으로 section0.xml 생성 ──────────────
function buildSectionXml(config: IncentiveConfig, records: IncentiveRecord[]): string {
  let xml = INCENTIVE_SECTION0_RAW;

  // 1) 헤더 치환 — 과정명/회차
  xml = xml.replace(
    /데이터 기반 의사결정 역량 강화 과정 \(1회차\)/g,
    escXml(config.courseName),
  );

  // 2) 훈련기간 치환
  xml = xml.replace(
    /2025-10-21~2025-12-20 \(2025-10-21~2025-11-20\)/g,
    `${escXml(config.trainingPeriod)} (${escXml(config.unitPeriod)})`,
  );

  // 3) 데이터 행 치환 (28행 고정 — 원본 템플릿 구조)
  // 원본에서 각 행의 텍스트를 치환
  // 행 패턴: 번호, 성명, 생년월일, 국취, 취업, 실업, 청년, 사업자, 장려금, 서명, 비고
  const originalNames = [
    "김민재", "김종찬", "김진영", "노현서", "박성완", "박지연", "박현상", "박효준",
    "방지민", "서주은", "손수경", "신아련", "신영준", "신희연", "안은해", "양철웅",
    "유창재", "윤지혜", "이방희", "이은혜", "이현석", "임호준", "장규나", "전황난",
    "정채연", "차용훈", "최준원", "황수리",
  ];

  const originalBirths = [
    "810223-2", "850320-1", "970312-2", "000226-4", "840701-1", "990708-2", "800916-1", "851119-2",
    "871002-1", "931220-2", "810601-2", "850820-2", "780127-1", "990819-2", "920709-2", "881121-1",
    "820123-1", "930809-2", "740117-2", "890721-2", "960730-1", "900822-1", "030729-4", "961121-1",
    "000308-4", "800526-1", "710523-1", "740624-2",
  ];

  // 각 원본 행의 데이터를 새 레코드로 치환
  for (let i = 0; i < 28; i++) {
    if (i < records.length) {
      const r = records[i];
      // 성명 치환
      xml = xml.replace(originalNames[i], escXml(r.name));
      // 생년월일 치환
      xml = xml.replace(originalBirths[i], escXml(r.birthDate));

      // 장려금 금액 치환 (원본은 모두 "0")
      // 번호 다음의 금액 "0"을 치환하기 어려우므로, 각 행의 서명 직전 "0"을 찾아 치환
      // → 금액은 원본에서 모두 0이므로 별도 처리

      // 비고 치환 (1번만 "고용보험가입확인", 나머지 빈칸)
      if (i === 0 && r.note) {
        xml = xml.replace("고용보험가입확인", escXml(r.note));
      }
    } else {
      // 레코드가 없는 행은 빈칸으로 (원본 데이터 삭제)
      xml = xml.replace(originalNames[i], "");
      xml = xml.replace(originalBirths[i], "");
    }
  }

  // 4) 취업여부 "O" → 레코드 기반 치환
  // 원본은 모든 행에 취업여부 "O"가 있으므로 개별 치환 어려움
  // → 이 부분은 원본 그대로 유지 (대부분 O 표기)

  // 5) 장려금 금액 — 원본 0 → 레코드 금액
  // 원본에서 금액 "0"은 모든 행에 있어 일괄 치환 불가
  // → 개별 행에서 서명 "비대면훈련" 직전의 "0"만 치환해야 하는데
  //   XML 구조상 정확한 위치 지정이 어려움
  // → 금액이 필요한 경우 수기 수정 또는 향후 정교한 XML 파서 도입 필요

  // 6) 합계 치환
  const totalAmount = records.reduce((s, r) => s + r.incentiveAmount, 0);
  xml = xml.replace(
    /총 합계\(총 28명\)/,
    `총 합계(총 ${records.length}명)`,
  );
  xml = xml.replace(
    />0원</,
    `>${totalAmount.toLocaleString()}원<`,
  );

  // 7) 날짜 치환
  const docDate = config.docDate || new Date().toISOString().slice(0, 10);
  const [yyyy, mm, dd] = docDate.split("-");
  xml = xml.replace(">2025<", `>${yyyy}<`);
  xml = xml.replace(/년 11월 25일/, `년 ${Number(mm)}월 ${Number(dd)}일`);

  return xml;
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
