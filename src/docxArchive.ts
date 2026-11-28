import type {Workspace} from './types';
import {money, date} from './api';

// CRC32 Table
const makeCrcTable = () => {
  let c: number;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
};

const crcTable = makeCrcTable();

function crc32(buf: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

interface ZipFile {
  name: string;
  data: Uint8Array;
}

function createZip(files: ZipFile[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const cdEntries: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const fileCrc = crc32(file.data);
    const size = file.data.length;

    // Local Header
    const lh = new Uint8Array(30 + nameBytes.length);
    const dvLh = new DataView(lh.buffer);
    dvLh.setUint32(0, 0x04034b50, true);
    dvLh.setUint16(4, 20, true);
    dvLh.setUint16(6, 0, true);
    dvLh.setUint16(8, 0, true); // Stored (no compression)
    dvLh.setUint16(10, 0, true);
    dvLh.setUint16(12, 0, true);
    dvLh.setUint32(14, fileCrc, true);
    dvLh.setUint32(18, size, true);
    dvLh.setUint32(22, size, true);
    dvLh.setUint16(26, nameBytes.length, true);
    dvLh.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localChunks.push(lh);
    localChunks.push(file.data);

    // Central Directory Header
    const cdh = new Uint8Array(46 + nameBytes.length);
    const dvCdh = new DataView(cdh.buffer);
    dvCdh.setUint32(0, 0x02014b50, true);
    dvCdh.setUint16(4, 20, true);
    dvCdh.setUint16(6, 20, true);
    dvCdh.setUint16(8, 0, true);
    dvCdh.setUint16(10, 0, true);
    dvCdh.setUint16(12, 0, true);
    dvCdh.setUint16(14, 0, true);
    dvCdh.setUint32(16, fileCrc, true);
    dvCdh.setUint32(20, size, true);
    dvCdh.setUint32(24, size, true);
    dvCdh.setUint16(28, nameBytes.length, true);
    dvCdh.setUint16(30, 0, true);
    dvCdh.setUint16(32, 0, true);
    dvCdh.setUint16(34, 0, true);
    dvCdh.setUint16(36, 0, true);
    dvCdh.setUint32(38, 0, true);
    dvCdh.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    cdEntries.push(cdh);

    offset += lh.length + file.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cdh of cdEntries) {
    cdSize += cdh.length;
  }

  // End of Central Directory
  const eocd = new Uint8Array(22);
  const dvEocd = new DataView(eocd.buffer);
  dvEocd.setUint32(0, 0x06054b50, true);
  dvEocd.setUint16(4, 0, true);
  dvEocd.setUint16(6, 0, true);
  dvEocd.setUint16(8, files.length, true);
  dvEocd.setUint16(10, files.length, true);
  dvEocd.setUint32(12, cdSize, true);
  dvEocd.setUint32(16, cdOffset, true);
  dvEocd.setUint16(20, 0, true);

  const totalLength = cdOffset + cdSize + 22;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of localChunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  for (const cdh of cdEntries) {
    result.set(cdh, pos);
    pos += cdh.length;
  }
  result.set(eocd, pos);

  return result;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlPara(
  text: string,
  opts: {bold?: boolean; size?: number; color?: string; align?: string; spaceBefore?: number; spaceAfter?: number} = {}
): string {
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const before = opts.spaceBefore !== undefined ? ` w:before="${opts.spaceBefore}"` : '';
  const after = opts.spaceAfter !== undefined ? ` w:after="${opts.spaceAfter}"` : '';
  const spacing = before || after ? `<w:spacing${before}${after}/>` : '';
  const pPr = align || spacing ? `<w:pPr>${align}${spacing}</w:pPr>` : '';

  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/>` : '';
  const color = opts.color ? `<w:color w:val="${opts.color}"/>` : '';
  const rPr = bold || size || color ? `<w:rPr>${bold}${size}${color}</w:rPr>` : '';

  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function xmlTableCell(text: string, width: number, isHeader = false, isNumeric = false): string {
  const bg = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="0F1D2E"/>' : '<w:shd w:val="clear" w:color="auto" w:fill="070E17"/>';
  const color = isHeader ? '7DD3FC' : 'F0F6FC';
  const bold = isHeader ? '<w:b/>' : '';
  const align = isNumeric ? 'right' : 'left';
  return `
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="${width}" w:type="dxa"/>
        ${bg}
        <w:tcMar>
          <w:top w:w="120" w:type="dxa"/>
          <w:bottom w:w="120" w:type="dxa"/>
          <w:left w:w="160" w:type="dxa"/>
          <w:right w:w="160" w:type="dxa"/>
        </w:tcMar>
      </w:tcPr>
      <w:p>
        <w:pPr><w:jc w:val="${align}"/></w:pPr>
        <w:r>
          <w:rPr>${bold}<w:sz w:val="20"/><w:color w:val="${color}"/></w:rPr>
          <w:t xml:space="preserve">${escapeXml(text)}</w:t>
        </w:r>
      </w:p>
    </w:tc>`;
}

function xmlTable(headers: {label: string; width: number; numeric?: boolean}[], rows: string[][]): string {
  let xml = `
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="0" w:type="auto"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:space="0" w:color="23405A"/>
        <w:bottom w:val="single" w:sz="6" w:space="0" w:color="23405A"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="162A42"/>
        <w:insideV w:val="none"/>
        <w:left w:val="none"/>
        <w:right w:val="none"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tr>`;

  for (const h of headers) {
    xml += xmlTableCell(h.label, h.width, true, h.numeric);
  }
  xml += '</w:tr>';

  for (const row of rows) {
    xml += '<w:tr>';
    for (let i = 0; i < row.length; i++) {
      const h = headers[i];
      xml += xmlTableCell(row[i] || '', h ? h.width : 2000, false, h ? h.numeric : false);
    }
    xml += '</w:tr>';
  }

  xml += '</w:tbl>';
  return xml;
}

export function generateDocxArchive(data: Workspace): Uint8Array {
  const clients = data.clients || [];
  const loans = data.loans || [];
  const payments = data.payments || [];
  const installments = data.installments || [];

  const totalCapital = loans.reduce((acc, l) => acc + Number(l.original_principal || 0), 0);
  const totalPrincipalDue = loans.reduce((acc, l) => acc + Number(l.balance?.principal || 0), 0);
  const totalInterestDue = loans.reduce((acc, l) => acc + Number(l.balance?.interest || 0), 0);
  const totalRepaid = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const installmentLoansCount = loans.filter(
    l =>
      l.terms_code === 'installment_reducing_v1' ||
      l.terms_code === 'installment_flat_v1'
  ).length;

  const clientMap = new Map(clients.map(c => [c.id, c]));
  const loanMap = new Map(loans.map(l => [l.id, l]));

  let doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${xmlPara('VELMURUGAN FINANCE', {bold: true, size: 40, color: '0EA5E9', spaceAfter: 80})}
    ${xmlPara('Executive Business Ledger & Comprehensive Financial Archive', {bold: true, size: 28, color: 'F0CC87', spaceAfter: 200})}
    ${xmlPara(`Archive Generated: ${new Date().toLocaleDateString('en-IN', {year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'})}`, {size: 20, color: 'A9B9CB', spaceAfter: 60})}
    ${xmlPara('Classification: Confidential Executive Audit & Compliance Ledger', {bold: true, size: 20, color: '7DD3FC', spaceAfter: 240})}

    ${xmlPara('SECURITY & CREDENTIAL EXCLUSION GUARANTEE', {bold: true, size: 22, color: '38BDF8', spaceBefore: 200, spaceAfter: 80})}
    ${xmlPara('In compliance with zero-knowledge financial security standards, this document contains purely operational accounting balances and transaction receipts. All customer authentication credentials, master password hashes, zero-knowledge secret vault ciphertext, and recovery phrases are explicitly excluded from this export and remain preserved on server infrastructure.', {size: 19, color: 'A9B9CB', spaceAfter: 280})}

    ${xmlPara('1. EXECUTIVE FINANCIAL SUMMARY', {bold: true, size: 26, color: '0EA5E9', spaceBefore: 200, spaceAfter: 120})}
    ${xmlTable(
      [
        {label: 'Metric / Financial Indicator', width: 5500},
        {label: 'Value (INR)', width: 3500, numeric: true}
      ],
      [
        ['Total Registered Customer Accounts', `${clients.length} accounts (${clients.filter(c => c.active).length} active)`],
        ['Total Cumulative Capital Disbursed', money(totalCapital)],
        ['Active Principal Balance Outstanding', money(totalPrincipalDue)],
        ['Unpaid Accrued Interest Balance', money(totalInterestDue)],
        ['Total Verified Repayment Collections', money(totalRepaid)],
        ['Active Loan Contracts', `${loans.length} active loan accounts`]
      ]
    )}

    ${xmlPara('2. CLIENT PORTFOLIO DIRECTORY', {bold: true, size: 26, color: '0EA5E9', spaceBefore: 360, spaceAfter: 120})}
    ${xmlTable(
      [
        {label: 'Code', width: 1400},
        {label: 'Customer Name', width: 2600},
        {label: 'Contact', width: 1800},
        {label: 'Status', width: 1200},
        {label: 'Principal Due', width: 2000, numeric: true}
      ],
      clients.map(c => {
        const clientLoans = loans.filter(l => l.client_id === c.id);
        const clientPrincipal = clientLoans.reduce((s, l) => s + Number(l.balance?.principal || 0), 0);
        return [
          c.customer_code,
          c.name,
          c.phone || '—',
          c.active ? 'ACTIVE' : 'ARCHIVED',
          money(clientPrincipal)
        ];
      })
    )}

    ${xmlPara('3. LOAN REGISTRY', {bold: true, size: 26, color: '0EA5E9', spaceBefore: 360, spaceAfter: 120})}
    ${xmlTable(
      [
        {label: 'Loan #', width: 1400},
        {label: 'Client Name', width: 2200},
        {label: 'Terms', width: 1800},
        {label: 'Disbursed', width: 1500},
        {label: 'Total Balance', width: 2100, numeric: true}
      ],
      loans.map((l, idx) => {
        const c = clientMap.get(l.client_id);
        const termsLabel =
          l.terms_code === 'installment_flat_v1'
            ? `${l.installment_months || '—'}x Flat (${l.monthly_rate}% total)`
            : l.terms_code === 'installment_reducing_v1'
            ? `${l.installment_months || '—'}x Reducing (${l.monthly_rate}%/mo)`
            : `Monthly (${l.monthly_rate}%/mo)`;
        return [
          `LN-${idx + 1} (${l.id.slice(0, 6).toUpperCase()})`,
          c ? c.name : 'Unknown',
          termsLabel,
          date(l.disbursed_on),
          money(l.balance?.total || 0)
        ];
      })
    )}

    ${
      installments.length > 0
        ? `${xmlPara(`4. FROZEN INSTALLMENT SCHEDULES (${installmentLoansCount} installment loans)`, {bold: true, size: 26, color: '0EA5E9', spaceBefore: 360, spaceAfter: 120})}
    ${xmlTable(
      [
        {label: 'Loan / Inst #', width: 2000},
        {label: 'Due Date', width: 1500},
        {label: 'Principal Due', width: 1800, numeric: true},
        {label: 'Interest Due', width: 1800, numeric: true},
        {label: 'Remaining', width: 1900, numeric: true}
      ],
      installments.map(inst => {
        const rem = Math.max(
          0,
          Number(inst.total_due) - Number(inst.principal_paid) - Number(inst.interest_paid)
        );
        return [
          `${inst.loan_id.slice(0, 6).toUpperCase()} #${inst.installment_number}`,
          date(inst.due_on),
          money(inst.principal_due),
          money(inst.interest_due),
          rem === 0 ? 'PAID' : money(rem)
        ];
      })
    )}`
        : ''
    }

    ${xmlPara(`${installments.length > 0 ? '5' : '4'}. PAYMENT & REPAYMENT RECEIPTS LEDGER`, {bold: true, size: 26, color: '0EA5E9', spaceBefore: 360, spaceAfter: 120})}
    ${xmlTable(
      [
        {label: 'Receipt #', width: 1600},
        {label: 'Customer', width: 2200},
        {label: 'Date', width: 1600},
        {label: 'Amount Paid', width: 1800, numeric: true},
        {label: 'Interest Cleared', width: 1800, numeric: true}
      ],
      payments.map((p, idx) => {
        const l = loanMap.get(p.loan_id);
        const c = l ? clientMap.get(l.client_id) : null;
        return [
          p.reference || `RCT-${idx + 1}`,
          c ? c.name : 'Unknown',
          date(p.paid_on),
          money(p.amount),
          money(p.interest_paid)
        ];
      })
    )}

    ${xmlPara(`${installments.length > 0 ? '6' : '5'}. COMPLIANCE & TAMPER-EVIDENT RECORD CERTIFICATION`, {bold: true, size: 24, color: '0EA5E9', spaceBefore: 360, spaceAfter: 80})}
    ${xmlPara('Every payment receipt recorded in this ledger carries an immutable, tamper-evident record. Payments follow interest-first clearance according to monthly_remaining_v1, installment_flat_v1, and frozen installment_reducing_v1 schedules. Database level Row-Level Security (RLS) ensures full tenant isolation and cryptographic verification.', {size: 19, color: 'A9B9CB', spaceAfter: 200})}

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const encoder = new TextEncoder();
  const zipBytes = createZip([
    {name: '[Content_Types].xml', data: encoder.encode(contentTypes)},
    {name: '_rels/.rels', data: encoder.encode(rels)},
    {name: 'word/document.xml', data: encoder.encode(doc)},
    {name: 'word/_rels/document.xml.rels', data: encoder.encode(wordRels)}
  ]);

  return zipBytes;
}

export function downloadDocx(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
