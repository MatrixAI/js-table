import path from 'path';
import b from 'benny';
import Table from '@';
import { suiteCommon } from './utils';

async function main() {
  const summary = await b.suite(
    path.basename(__filename, path.extname(__filename)),
    b.add('insert', () => {
      const t = new Table(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']);
      return () => {
        t.insertRow({ a: 1, b: 2, c: 3, d: 4 });
      };
    }),
    b.add('delete row', () => {
      const t = new Table(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']);
      const rI = t.insertRow({ a: 1, b: 2, c: 3, d: 4 });
      return () => {
        t.deleteRow(rI);
      };
    }),
    b.add('get where rows - 100', () => {
      const t = new Table(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']);
      for (let i = 0; i < 100; i++) {
        t.insertRow({ a: 1, b: 2, c: 3, d: 4 });
      }
      return () => {
        const rIs = t.whereRows('a', 1);
        rIs.map((rI) => t.getRow(rI));
      };
    }),
    ...suiteCommon,
  );
  return summary;
}

if (require.main === module) {
  void main();
}

export default main;
