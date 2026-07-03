const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const db = new Database(path.join(__dirname, 'prisma/dev.db'));

function parsePtBrFloat(val) {
  if (!val) return 0.0;
  let s = val.replace('%', '').trim();
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return parseFloat(s) || 0.0;
}

try {
  const csvFile = fs.readFileSync(path.join(__dirname, 'dados.csv'), 'utf-8');
  const registros = parse(csvFile, { columns: true, skip_empty_lines: true, trim: true, bom: true });

  const insert = db.prepare(`
    INSERT INTO Operacao (
      id, data, ativo, operacao, tipo, codigo, qtde, cotacaoAcao, strike, 
      premioUnInicial, premioTotalBruto, distanciaStrike, exercendo, 
      cotacaoOpcao, lucroCapturado, custoRecompraTotal, resultadoBrutoReal, 
      valorExercicioUn, valorExercEfetivoTotal, darf, resultadoLiquido, dataEncerramento, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction((rows) => {
    for (const row of rows) {
      const status = row['Data encerramento'] ? 'Zerada' : 'Aberta';
      insert.run(
        uuidv4(),
        row['Data'], row['Ativo'], row['Operação'], row['Tipo'], row['Código'],
        parseInt(row['Qtde'].replace(/\./g, '')) || 0,
        parsePtBrFloat(row['Cotação ação']), parsePtBrFloat(row['Strike']),
        parsePtBrFloat(row['Prêmio Un. Inicial']), parsePtBrFloat(row['Prêmio Total Bruto']),
        row['Distância do Strike (%)'], row['Exercendo?'], parsePtBrFloat(row['Cotação opção']),
        row['% Lucro Capturado'], parsePtBrFloat(row['Custo Recompra Total']),
        parsePtBrFloat(row['Resultado Bruto Real']), parsePtBrFloat(row['Valor de Exercício Un.']),
        parsePtBrFloat(row['Valor Exerc. Efetivo Total']),
        parsePtBrFloat(row['DARF']), parsePtBrFloat(row['Resultado Líquido']),
        row['Data encerramento'] || null, status
      );
    }
  })(registros);

  console.log(`🚀 Carga realizada: ${registros.length} linhas processadas.`);
} catch (e) { console.error(e.message); } finally { db.close(); }