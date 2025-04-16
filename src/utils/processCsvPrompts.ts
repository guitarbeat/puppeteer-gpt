import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { csvLogger } from './logger';

export interface CsvPromptRow {
  student_name: string;
  student_id: string;
  file_paths: string;
  has_video: string;
  prompt: string;
  response: string;
}

/**
 * Read and parse a CSV file containing prompts
 * @param csvPath Path to the CSV file
 * @returns Array of CSV rows
 */
export async function readCsvPrompts(csvPath: string): Promise<CsvPromptRow[]> {
  try {
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const result = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });
    
    // @ts-ignore - Papaparse types are incomplete
    const rows: CsvPromptRow[] = result.data;
    
    // Validate and normalize file paths
    return rows.map(validateFilePaths);
  } catch (error) {
    csvLogger.error(`Error reading CSV file: ${csvPath}`, error);
    throw error;
  }
}

/**
 * Validate and fix file paths in a CSV row
 * @param row CSV row to validate
 * @returns Updated row with validated/fixed paths
 */
function validateFilePaths(row: CsvPromptRow): CsvPromptRow {
  if (!row.file_paths || row.file_paths.trim() === '') {
    return row;
  }
  
  // Process multiple file paths separated by pipe
  const filePaths = row.file_paths.split('|').map(filePath => filePath.trim());
  const validatedPaths: string[] = [];
  
  for (const filePath of filePaths) {
    try {
      // Decode URI components to handle URL-encoded characters
      const decodedPath = decodeURIComponent(filePath);
      
      // Try the path as is
      if (fs.existsSync(decodedPath)) {
        validatedPaths.push(decodedPath);
        continue;
      }
      
      // Try with spaces explicitly handled
      if (filePath.includes(' ')) {
        // Path with spaces can be problematic
        const altPath = filePath.replace(/\s+/g, '\\ ');
        if (fs.existsSync(altPath)) {
          validatedPaths.push(altPath);
          continue;
        }
      }
      
      // Log if file not found
      csvLogger.warn(`File not found: ${filePath} for student ${row.student_name} (${row.student_id})`);
    } catch (error) {
      csvLogger.warn(`Error validating file path: ${filePath}`, error);
    }
  }
  
  // If we have any valid paths, update the row
  if (validatedPaths.length > 0) {
    return {
      ...row,
      file_paths: validatedPaths.join('|')
    };
  }
  
  // If we couldn't validate any paths, return the original
  return row;
}

/**
 * Write data back to the CSV file
 * @param csvPath Path to the CSV file
 * @param rows Array of CSV rows
 */
export function writeCsvPrompts(csvPath: string, rows: CsvPromptRow[]): void {
  try {
    const backupPath = `${csvPath}.bak`;
    
    // First create a backup of the existing file
    if (fs.existsSync(csvPath) && !fs.existsSync(backupPath)) {
      fs.copyFileSync(csvPath, backupPath);
      csvLogger.info(`Created backup of original CSV at ${backupPath}`);
    }
    
    // Write the updated data
    const csvContent = Papa.unparse(rows, {
      header: true,
      quotes: true
    });
    fs.writeFileSync(csvPath, csvContent, 'utf-8');
  } catch (error) {
    csvLogger.error(`Error writing to CSV file: ${csvPath}`, error);
    throw error;
  }
}