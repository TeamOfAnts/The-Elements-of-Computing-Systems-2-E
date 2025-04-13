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
    const segment = SEGMENTS[arg1];

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
    }

    if (typeof segment === 'function') {
      const addr = segment(arg2);
      return [
        `@${addr}`,
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        '@SP',
        'M=M+1',
      ];
    }

    return [
      `@${segment}`,
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

  if (cmd === 'pop') {
    const segment = SEGMENTS[arg1];

    if (typeof segment === 'function') {
      const addr = segment(arg2);
      return [
        '@SP',
        'AM=M-1',
        'D=M',
        `@${addr}`,
        'M=D',
      ];
    }

    return [
      `@${segment}`,
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

  if (cmd === 'add' || cmd === 'sub') {
    const op = cmd === 'add' ? 'D+M' : 'M-D';
    return [
      '@SP',
      'AM=M-1',
      'D=M',
      'A=A-1',
      `M=${op}`,
    ];
  }

  if (cmd === 'eq' || cmd === 'lt' || cmd === 'gt') {
    const jumpMap = { eq: 'JEQ', lt: 'JLT', gt: 'JGT' };
    const jump = jumpMap[cmd];
    const labelTrue = `COMP_TRUE_${labelCounter}`;
    const labelEnd = `COMP_END_${labelCounter}`;
    labelCounter++;

    return [
      '@SP',
      'AM=M-1',
      'D=M',
      'A=A-1',
      'D=M-D',
      `@${labelTrue}`,
      `D;${jump}`,
      '@SP',
      'A=M-1',
      'M=0',
      `@${labelEnd}`,
      '0;JMP',
      `(${labelTrue})`,
      '@SP',
      'A=M-1',
      'M=-1',
      `(${labelEnd})`,
    ];
  }

  if (cmd === 'label') {
    return [`(${arg1})`];
  }

  if (cmd === 'goto') {
    return [`@${arg1}`, '0;JMP'];
  }

  if (cmd === 'if-goto') {
    return [
      '@SP',
      'AM=M-1',
      'D=M',
      `@${arg1}`,
      'D;JNE',
    ];
  }

  if (cmd === 'function') {
    const init = [];
    for (let i = 0; i < Number(arg2); i++) {
      init.push(
        '@0',
        'D=A',
        '@SP',
        'A=M',
        'M=D',
        '@SP',
        'M=M+1',
      );
    }
    return [`(${arg1})`, ...init];
  }

  if (cmd === 'call') {
    const returnLabel = `RETURN_LABEL${labelCounter++}`;
    return [
      `@${returnLabel}`,
      'D=A',
      '@SP',
      'A=M',
      'M=D',
      '@SP',
      'M=M+1',

      '@LCL',
      'D=M',
      '@SP',
      'A=M',
      'M=D',
      '@SP',
      'M=M+1',

      '@ARG',
      'D=M',
      '@SP',
      'A=M',
      'M=D',
      '@SP',
      'M=M+1',

      '@THIS',
      'D=M',
      '@SP',
      'A=M',
      'M=D',
      '@SP',
      'M=M+1',

      '@THAT',
      'D=M',
      '@SP',
      'A=M',
      'M=D',
      '@SP',
      'M=M+1',

      '@SP',
      'D=M',
      `@${Number(arg2) + 5}`,
      'D=D-A',
      '@ARG',
      'M=D',

      '@SP',
      'D=M',
      '@LCL',
      'M=D',

      `@${arg1}`,
      '0;JMP',
      `(${returnLabel})`,
    ];
  }

  if (cmd === 'return') {
    return [
      '@LCL',
      'D=M',
      '@R13',
      'M=D',

      '@5',
      'A=D-A',
      'D=M',
      '@R14',
      'M=D',

      '@SP',
      'AM=M-1',
      'D=M',
      '@ARG',
      'A=M',
      'M=D',

      '@ARG',
      'D=M+1',
      '@SP',
      'M=D',

      '@R13',
      'AM=M-1',
      'D=M',
      '@THAT',
      'M=D',

      '@R13',
      'AM=M-1',
      'D=M',
      '@THIS',
      'M=D',

      '@R13',
      'AM=M-1',
      'D=M',
      '@ARG',
      'M=D',

      '@R13',
      'AM=M-1',
      'D=M',
      '@LCL',
      'M=D',

      '@R14',
      'A=M',
      '0;JMP',
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

// 실행 예시
const inputPath = process.argv[2]; // ex: BasicLoop.vm
const outputPath = inputPath.replace(/\.vm$/, '.asm');
const vmCode = fs.readFileSync(inputPath, 'utf-8');
const asmCode = translateVMFile(vmCode);
fs.writeFileSync(outputPath, asmCode);

console.log(`✅ Translated: ${outputPath}`);
