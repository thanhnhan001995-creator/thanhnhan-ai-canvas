import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import fs from "node:fs/promises";

const source = "C:/Users/Owner/Desktop/danh-sach-node-san-xuat-video-ai.xlsx";
const input = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 20000,
  tableMaxRows: 12,
  tableMaxCols: 16,
  tableMaxCellChars: 180,
});

console.log(summary.ndjson);

const sheet = workbook.worksheets.getItem("Danh sách node");
const values = sheet.getRange("A1:F197").values;
await fs.writeFile("node-structure.json", JSON.stringify(values, null, 2), "utf8");

const styles = await workbook.inspect({
  kind: "computedStyle",
  sheetId: "Danh sách node",
  range: "A1:F20",
  maxChars: 4000,
});
console.log(styles.ndjson);

const preview = await workbook.render({
  sheetName: "Danh sách node",
  range: "A1:F35",
  scale: 1.2,
  format: "png",
});
await fs.writeFile("node-structure-preview.png", new Uint8Array(await preview.arrayBuffer()));
