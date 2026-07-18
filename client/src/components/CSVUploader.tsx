import { useState } from 'react';
import { Upload, Download, X, Clipboard } from 'lucide-react';
import { parseCSV, parseSEBText, generateCSVTemplate, generateBillsCSVTemplate, CSVResult, ParsedBill, ParsedIncome, deduplicateBills, deduplicateIncomes } from '../utils/csvParser';

interface CSVUploaderProps {
  onDataLoaded: (incomes: ParsedIncome[], bills: ParsedBill[]) => void;
}

export default function CSVUploader({ onDataLoaded }: CSVUploaderProps) {
  const [parsedData, setParsedData] = useState<CSVResult | null>(null);
  const [pasteMode, setPasteMode] = useState<'csv' | 'seb'>('csv');
  const [pastedText, setPastedText] = useState('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const allIncomes: ParsedIncome[] = [];
    const allBills: ParsedBill[] = [];
    const allErrors: string[] = [];

    for (const file of Array.from(files)) {
      const content = await file.text();
      const result = parseCSV(content);
      allIncomes.push(...result.incomes);
      allBills.push(...result.bills);
      if (result.errors.length > 0) {
        allErrors.push(`${file.name}: ${result.errors.join(', ')}`);
      }
    }

    const combined: CSVResult = {
      incomes: deduplicateIncomes(allIncomes),
      bills: deduplicateBills(allBills),
      errors: allErrors,
    };
    setParsedData(combined);

    if (combined.incomes.length > 0 || combined.bills.length > 0) {
      onDataLoaded(combined.incomes, combined.bills);
    }
  };

  const handleDownloadTemplate = () => {
    const template = generateCSVTemplate();
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'income_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadBillsTemplate = () => {
    const template = generateBillsCSVTemplate();
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bills_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setParsedData(null);
    setPastedText('');
    onDataLoaded([], []);
  };

  const handleSEBTextPaste = () => {
    if (!pastedText.trim()) return;

    const result = parseSEBText(pastedText);
    setParsedData(result);

    if (result.bills.length > 0) {
      onDataLoaded([], result.bills);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h3 className="text-lg font-semibold mb-4">Importera räkningar</h3>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setPasteMode('csv')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            pasteMode === 'csv'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          CSV fil
        </button>
        <button
          onClick={() => setPasteMode('seb')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            pasteMode === 'seb'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Klistra in från bank
        </button>
      </div>

      <div className="space-y-4">
        {pasteMode === 'csv' ? (
          <div className="flex gap-4">
            <label className="flex-1 cursor-pointer">
              <div className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-indigo-500 transition">
                <Upload className="h-5 w-5 text-gray-500" />
                <span className="text-gray-600">Ladda upp CSV filer (flera möjligt)</span>
              </div>
              <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Klistra in från bank (markera och kopiera från "Kommande transaktioner")
            </label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Klistra in bankdata här...
Fungerar med SEB, Swedbank, Nordea och fler banker.
Exempel:
Datum	Kontotext	Insättning	Uttag	Saldo
2026-04-28	Lån 44685736	0	-2 142,00	-2 142,00
2026-04-28	Vattenfall Kundservice A	0	-2 405,78	-16 032,78"
              className="w-full h-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
            />
            <button
              onClick={handleSEBTextPaste}
              className="mt-2 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              <Clipboard className="h-4 w-4" />
              Importera
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
          >
            <Download className="h-4 w-4" />
            Ladda ner inkomst-mall
          </button>
          <button
            onClick={handleDownloadBillsTemplate}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
          >
            <Download className="h-4 w-4" />
            Ladda ner räkning-mall
          </button>
        </div>

        {parsedData && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium">Importerad data</h4>
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
                Rensa
              </button>
            </div>

            {parsedData.incomes.length > 0 && (
              <div className="mb-4">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Inkomster ({parsedData.incomes.length})</h5>
                <div className="max-h-32 overflow-y-auto bg-gray-50 rounded p-2">
                  {parsedData.incomes.map((income, index) => (
                    <div key={index} className="flex justify-between text-sm py-1">
                      <span>{income.name}</span>
                      <span>kr {income.income.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsedData.bills.length > 0 && (
              <div className="mb-4">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Räkningar ({parsedData.bills.length})</h5>
                <div className="max-h-32 overflow-y-auto bg-gray-50 rounded p-2">
                  {parsedData.bills.map((bill, index) => (
                    <div key={index} className="flex justify-between items-center text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span>{bill.name}</span>
                        {!bill.isShared && (
                          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">Individuell</span>
                        )}
                      </div>
                      <span>kr {bill.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsedData.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <h5 className="text-sm font-medium text-red-700 mb-2">Fel ({parsedData.errors.length})</h5>
                <ul className="text-xs text-red-600 space-y-1">
                  {parsedData.errors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
