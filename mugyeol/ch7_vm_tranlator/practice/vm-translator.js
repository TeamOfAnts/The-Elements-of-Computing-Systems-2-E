const fs = require('fs');
const path = require('path');

const SEGMENTS = {
  argument: 'ARG',
  local: 'LCL',
  this: 'THIS',
  that: 'THAT',
  temp: i => `R${5 + parseInt(i, 10)}`,
  pointer: i => (i === '0' ? 'THIS' : 'THAT'),
  static: i => `Static.${i}`,
  constant: null,
};

let labelCounter = 0;

function translateLine(line) {
  const tokens = line.trim().split(/\s+/);
  const [cmd, arg1, arg2] = tokens;

  if (cmd === 'push') {
    if (arg1 === 'constant') {
      return [
        `@${arg2}`,
        'D=A',
        '@SP',
        'A=M',
        'M=D',
        '@SP',
        'M=M+1',
      ];
    } else if (arg1 === 'temp' || arg1 === 'pointer' || arg1 === 'static') {
      const addr = SEGMENTS[arg1](arg2);
      return [
        `@${addr}`,
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        '@SP',
        'M=M+1',
      ];
    } else {
      return [
        `@${SEGMENTS[arg1]}`,
        'D=M',
        `@${arg2}`,
        'A=D+A',
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        '@SP',
        'M=M+1',
      ];
    }
  }

  if (cmd === 'pop') {
    if (arg1 === 'temp' || arg1 === 'pointer' || arg1 === 'static') {
      const addr = SEGMENTS[arg1](arg2);
      return [
        '@SP',
        'AM=M-1',
        'D=M',
        `@${addr}`,
        'M=D',
      ];
    } else {
      return [
        `@${SEGMENTS[arg1]}`,
        'D=M',
        `@${arg2}`,
        'D=D+A',
        '@R13',
        'M=D',
        '@SP',
        'AM=M-1',
        'D=M',
        '@R13',
        'A=M',
        'M=D',
      ];
    }
  }

  if (cmd === 'add' || cmd === 'sub') {
    const op = cmd === 'add' ? '+' : '-';
    return [
      '@SP',
      'AM=M-1',
      'D=M',
      'A=A-1',
      `M=M${op}D`,
    ];
  }

  throw new Error(`Unsupported command: ${line}`);
}

function translateVMFile(vmCode) {
  const lines = vmCode
    .split('\n')
    .map(line => line.split('//')[0].trim())
    .filter(Boolean);

  const asmLines = [];

  for (const line of lines) {
    const asm = translateLine(line);
    asmLines.push(`// ${line}`, ...asm);
  }

  return asmLines.join('\n');
}

// 사용 예시
const inputPath = process.argv[2]; // ex: BasicTest.vm
const outputPath = inputPath.replace(/\.vm$/, '.asm');
const vmCode = fs.readFileSync(inputPath, 'utf-8');
const asmCode = translateVMFile(vmCode);
fs.writeFileSync(outputPath, asmCode);

console.log(`✅ Translated: ${outputPath}`);
