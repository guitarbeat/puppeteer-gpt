import fs from 'fs';
import Papa from 'papaparse';

export interface CsvPromptRow {
  attachment: string;
  prompt: string;
  response?: string;
}

export function readCsvPrompts(filePath: string): Promise<CsvPromptRow[]> {
  return new Promise((resolve, reject) => {
    try {
      const file = fs.readFileSync(filePath, 'utf8');
      const result = Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
      });
      // @ts-ignore - Papaparse types are incomplete
      resolve(result.data);
    } catch (error) {
      reject(error);
    }
  });
}

export function writeCsvPrompts(filePath: string, rows: CsvPromptRow[]): void {
  const csv = Papa.unparse(rows, { header: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}