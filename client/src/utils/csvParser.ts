export interface ParsedBill {
  name: string;
  amount: number;
  isShared: boolean;
  payer?: string;
  date?: string;
}

// Deduplication key: date + name + amount uniquely identifies a transaction
export function billKey(bill: ParsedBill): string {
  return `${bill.date || ''}|${bill.name.toLowerCase().trim()}|${bill.amount}`;
}

// Remove duplicate bills/incomes based on dedup key
export function deduplicateBills(bills: ParsedBill[]): ParsedBill[] {
  const seen = new Set<string>();
  const result: ParsedBill[] = [];
  for (const bill of bills) {
    const key = billKey(bill);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(bill);
    }
  }
  return result;
}

export function deduplicateIncomes(incomes: ParsedIncome[]): ParsedIncome[] {
  const seen = new Set<string>();
  const result: ParsedIncome[] = [];
  for (const inc of incomes) {
    const key = `${inc.name.toLowerCase().trim()}|${inc.income}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(inc);
    }
  }
  return result;
}

export interface ParsedIncome {
  name: string;
  income: number;
}

export interface CSVResult {
  incomes: ParsedIncome[];
  bills: ParsedBill[];
  errors: string[];
}

function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

function detectSeparator(line: string): ',' | ';' | '\t' {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  return ',';
}

export function parseCSV(content: string): CSVResult {
  content = stripBOM(content);
  const lines = content.trim().split('\n');
  const result: CSVResult = {
    incomes: [],
    bills: [],
    errors: [],
  };

  if (lines.length === 0) {
    result.errors.push('CSV filen är tom');
    return result;
  }

  const sep = detectSeparator(lines[0]);

  // Check if this is a SEB bank export (has Bokföringsdatum or similar bank headers)
  const headerLower = lines[0].toLowerCase();
  if (headerLower.includes('bokföringsdatum') || headerLower.includes('valutadatum') ||
      (headerLower.includes('belopp') && headerLower.includes('text') && sep === ';')) {
    return parseSEBCSV(content);
  }

  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
  
  // Detect if this is an income/bills format or custom format
  const hasIncome = headers.some(h => h.includes('income') || h.includes('inkomst'));
  const hasName = headers.some(h => h.includes('name') || h.includes('namn'));
  const hasBill = headers.some(h => h.includes('bill') || h.includes('räkning') || h.includes('amount'));
  const hasShared = headers.some(h => h.includes('shared') || h.includes('gemensam'));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(sep).map(v => v.trim());
    
    if (values.length !== headers.length) {
      result.errors.push(`Rad ${i + 1}: Fel antal kolumner`);
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });

    try {
      if (hasIncome && hasName) {
        // Parse as income row
        const name = row['name'] || row['namn'] || '';
        const income = parseFloat(row['income'] || row['inkomst'] || '0');
        
        if (!name) {
          result.errors.push(`Rad ${i + 1}: Saknar namn`);
          continue;
        }
        
        if (isNaN(income)) {
          result.errors.push(`Rad ${i + 1}: Ogiltig inkomst`);
          continue;
        }

        result.incomes.push({ name, income });
      } else if (hasBill && hasName) {
        // Parse as bill row
        const name = row['name'] || row['namn'] || row['bill'] || row['räkning'] || '';
        const amount = parseFloat(row['amount'] || row['belopp'] || row['bill'] || '0');
        const isShared = hasShared 
          ? row['shared']?.toLowerCase() === 'true' || row['gemensam']?.toLowerCase() === 'ja'
          : true;
        const payer = row['payer'] || row['betalare'];

        if (!name) {
          result.errors.push(`Rad ${i + 1}: Saknar räkningens namn`);
          continue;
        }

        if (isNaN(amount)) {
          result.errors.push(`Rad ${i + 1}: Ogiltigt belopp`);
          continue;
        }

        result.bills.push({ name, amount, isShared, payer });
      }
    } catch (error) {
      result.errors.push(`Rad ${i + 1}: Kunde inte tolka raden`);
    }
  }

  return result;
}

export function generateCSVTemplate(): string {
  return `name,income
Anna,50000
Björn,35000
Erik,42000`;
}

export function generateBillsCSVTemplate(): string {
  return `name,amount,shared,payer
Hyra,8000,true,
El,500,true,
Netflix,150,false,Anna
Internet,300,true,`;
}

export function parseSEBText(content: string): CSVResult {
  return parseBankText(content);
}

// Dedicated SEB CSV parser (semicolon-separated, BOM, Swedish headers)
export function parseSEBCSV(content: string): CSVResult {
  content = stripBOM(content);
  const lines = content.trim().split('\n');
  const result: CSVResult = {
    incomes: [],
    bills: [],
    errors: [],
  };

  if (lines.length === 0) {
    result.errors.push('CSV filen är tom');
    return result;
  }

  const sep = detectSeparator(lines[0]);
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());

  // Find column indices for SEB format
  let dateCol = -1;
  let descCol = -1;
  let amountCol = -1;

  headers.forEach((h, i) => {
    if (h.includes('datum') || h.includes('date')) dateCol = i;
    else if (h.includes('text') || h.includes('beskriv') || h.includes('description')) descCol = i;
    else if (h.includes('belopp') || h.includes('amount')) amountCol = i;
  });

  if (dateCol === -1 || descCol === -1 || amountCol === -1) {
    result.errors.push('Kunde inte hitta kolumner i SEB CSV-filen');
    return result;
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(sep).map(v => v.trim());
    if (values.length <= Math.max(dateCol, descCol, amountCol)) continue;

    const description = values[descCol];
    let amountStr = values[amountCol];

    if (!description || !amountStr) continue;

    // SEB uses . as decimal separator
    amountStr = amountStr.replace(/\s/g, '').replace(',', '.');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount === 0) continue;

    if (amount < 0) {
      result.bills.push({
        name: description,
        amount: Math.abs(amount),
        isShared: true,
        date: values[dateCol] || undefined,
      });
    } else {
      result.incomes.push({
        name: description,
        income: amount,
      });
    }
  }

  if (result.bills.length === 0 && result.incomes.length === 0) {
    result.errors.push('Hittade inga transaktioner i SEB CSV-filen');
  }

  return result;
}

// Smart multi-bank parser
export function parseBankText(content: string): CSVResult {
  content = stripBOM(content);
  const lines = content.trim().split('\n');
  const result: CSVResult = {
    incomes: [],
    bills: [],
    errors: [],
  };

  if (lines.length === 0) {
    result.errors.push('Texten är tom');
    return result;
  }

  // Detect separator (semicolon, tab, comma, or multiple spaces)
  let separator: '\t' | ',' | ';' | 'spaces' = '\t';
  const firstLine = lines[0];
  if (firstLine.includes(';')) {
    separator = ';';
  } else if (firstLine.includes(',')) {
    separator = ',';
  } else if (firstLine.split(/\s{2,}/).length > 1) {
    separator = 'spaces'; // Multiple spaces
  }

  // Helper to split line based on separator
  const splitLine = (line: string): string[] => {
    if (separator === 'spaces') {
      return line.split(/\s{2,}/).map(v => v.trim());
    }
    return line.split(separator).map(v => v.trim());
  };

  // Find header line with date and description columns
  let headerIndex = -1;
  let dateCol = -1;
  let descCol = -1;
  let amountCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitLine(line);

    // Try to identify columns by content
    for (let j = 0; j < values.length; j++) {
      const val = values[j].toLowerCase();
      if (val.includes('datum') || val.includes('date')) {
        dateCol = j;
      } else if (val.includes('text') || val.includes('beskriv') || val.includes('konto') || val.includes('namn') || val.includes('description')) {
        descCol = j;
      } else if (val.includes('uttag') || val.includes('belopp') || val.includes('amount') || val.includes('insätt')) {
        amountCol = j;
      }
    }

    if (dateCol >= 0 && descCol >= 0 && amountCol >= 0) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    // Fallback: try to parse without explicit header
    // Assume first column is date, second is description, look for amount column
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.includes('transaktion') || line.includes('reserver') || line.includes('historik')) {
        continue;
      }

      const values = splitLine(line);
      if (values.length >= 2) {
        // Try to find which column has amount values
        for (let j = 2; j < values.length; j++) {
          const val = values[j].replace(/\s/g, '').replace(',', '.');
          if (!isNaN(parseFloat(val)) && val !== '0') {
            dateCol = 0;
            descCol = 1;
            amountCol = j;
            headerIndex = i;
            break;
          }
        }
        if (headerIndex >= 0) break;
      }
    }

    if (headerIndex === -1) {
      result.errors.push('Kunde inte detektera kolumner');
      return result;
    }
  }

  // Parse data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes('transaktion') || line.toLowerCase().includes('reserver') || line.toLowerCase().includes('historik') || line.toLowerCase().includes('total')) {
      continue;
    }

    const values = splitLine(line);
    if (values.length <= Math.max(dateCol, descCol, amountCol)) continue;

    const description = values[descCol];
    let amountStr = values[amountCol];

    if (!description || !amountStr) continue;

    // Parse amount - handle Swedish format (space as thousand separator, comma as decimal)
    amountStr = amountStr.replace(/\s/g, '').replace(',', '.');
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount === 0) continue;

    // Determine if it's a withdrawal (bill) or deposit (income)
    const isWithdrawal = amount < 0 || line.toLowerCase().includes('uttag') || line.toLowerCase().includes('debit');

    if (isWithdrawal) {
      result.bills.push({
        name: description,
        amount: Math.abs(amount),
        isShared: true,
      });
    } else {
      // Could be income - but for bill calculator we focus on bills
      // Optionally add to incomes if needed
    }
  }

  if (result.bills.length === 0) {
    result.errors.push('Hittade inga räkningar i texten');
  }

  return result;
}
