const fs = require('fs'); // Node.js 기본 모듈: 파일 시스템 접근용
const path = require('path'); // Node.js 기본 모듈: 경로 처리용

// VM 명령어에서 사용하는 세그먼트를 Hack 어셈블리용 주소나 함수로 매핑
const SEGMENTS = {
  argument: 'ARG', // 함수 인자의 시작 주소
  local: 'LCL',    // 지역 변수의 시작 주소
  this: 'THIS',    // this 객체의 참조 주소
  that: 'THAT',    // that 객체의 참조 주소
  temp: i => `R${5 + parseInt(i, 10)}`, // temp는 고정된 R5~R12 레지스터 사용
  pointer: i => (i === '0' ? 'THIS' : 'THAT'), // pointer 0 = THIS, 1 = THAT으로 변환
  static: i => `Static.${i}`, // static 세그먼트는 해당 VM 파일 내 고유 네임스페이스를 사용
  constant: null, // 상수는 메모리에 저장하지 않고 바로 값으로 사용됨
};

let labelCounter = 0; // 비교 연산 시 라벨 이름 중복 방지를 위한 카운터

function translateLine(line) {
  const tokens = line.trim().split(/\s+/); // 명령어와 인자를 공백 기준으로 파싱
  const [cmd, arg1, arg2] = tokens; // 각각 명령, 세그먼트, 인덱스 분리

  // push 명령어 처리
  if (cmd === 'push') {
    const segment = SEGMENTS[arg1];

    // push constant n → 상수를 스택에 올림
    if (arg1 === 'constant') {
      return [
        `@${arg2}`,       // A에 상수 주소(값)를 로드
        'D=A',             // D 레지스터에 상수 값 저장
        '@SP',             // SP 접근
        'A=M',             // SP가 가리키는 주소 접근
        'M=D',             // 해당 주소에 값 저장 (push 동작)
        '@SP',             // SP를 증가시켜 다음 빈 공간 가리키게 함
        'M=M+1',
      ];
    }

    // temp, pointer, static 등 함수로 주소 계산이 필요한 세그먼트 처리
    if (typeof segment === 'function') {
      const addr = segment(arg2);
      return [
        `@${addr}`,        // 해당 세그먼트의 절대 주소 접근
        'D=M',             // D에 해당 메모리 값 저장
        '@SP',             // SP 접근
        'A=M',             // SP가 가리키는 주소 접근
        'M=D',             // 값 저장
        '@SP',             // SP 증가
        'M=M+1',
      ];
    }

    // local, argument, this, that 세그먼트
    return [
      `@${segment}`,       // 세그먼트 베이스 주소 접근 (예: @LCL)
      'D=M',               // 베이스 주소값을 D에 저장
      `@${arg2}`,          // 오프셋 값 (예: 2)
      'A=D+A',             // 베이스 + 오프셋 주소 계산
      'D=M',               // 해당 주소의 실제 값 가져오기
      '@SP',               // SP 접근
      'A=M',
      'M=D',               // 값 저장
      '@SP',               // SP 증가
      'M=M+1',
    ];
  }

  // pop 명령어 처리
  if (cmd === 'pop') {
    const segment = SEGMENTS[arg1];

    // temp, pointer, static 같은 고정 주소에 직접 저장
    if (typeof segment === 'function') {
      const addr = segment(arg2);
      return [
        '@SP',              // SP 접근
        'AM=M-1',           // SP 감소 후 A=M
        'D=M',              // top 값 가져오기
        `@${addr}`,         // 대상 주소 접근
        'M=D',              // 값 저장
      ];
    }

    // 일반 세그먼트(local, argument 등)는 주소를 계산해야 하므로 R13 임시 저장
    return [
      `@${segment}`,        // 세그먼트 베이스 주소
      'D=M',
      `@${arg2}`,
      'D=D+A',              // 최종 주소 계산
      '@R13',
      'M=D',                // R13에 저장
      '@SP',
      'AM=M-1',             // SP 감소 및 top 주소로 이동
      'D=M',                // top 값
      '@R13',
      'A=M',                // 실제 저장 주소로 이동
      'M=D',                // 값 저장
    ];
  }

  // 산술 명령어: add
  if (cmd === 'add') {
    return [
      '@SP',
      'AM=M-1',             // SP 감소 후 top 접근
      'D=M',                // y 값
      'A=A-1',              // x 주소
      'M=D+M',              // x = x + y
    ];
  }

  // 산술 명령어: sub
  if (cmd === 'sub') {
    return [
      '@SP',
      'AM=M-1',
      'D=M',
      'A=A-1',
      'M=M-D',              // x = x - y
    ];
  }

  // 비교 명령어: eq, lt, gt
  if (cmd === 'eq' || cmd === 'lt' || cmd === 'gt') {
    const jumpMap = { eq: 'JEQ', lt: 'JLT', gt: 'JGT' };
    const jump = jumpMap[cmd];
    const labelTrue = `COMP_TRUE_${labelCounter}`;
    const labelEnd = `COMP_END_${labelCounter}`;
    labelCounter++;

    return [
      '@SP',
      'AM=M-1',             // y pop
      'D=M',
      'A=A-1',              // x
      'D=M-D',              // x - y
      `@${labelTrue}`,
      `D;${jump}`,          // jump if condition true
      '@SP',
      'A=M-1',
      'M=0',                // false (0)
      `@${labelEnd}`,
      '0;JMP',              // unconditional jump to end
      `(${labelTrue})`,     // true label
      '@SP',
      'A=M-1',
      'M=-1',               // true (-1)
      `(${labelEnd})`,
    ];
  }

  // label 명령어 → 어셈블리 라벨 정의
  if (cmd === 'label') {
    return [`(${arg1})`];
  }

  // goto 명령어 → 무조건 점프
  if (cmd === 'goto') {
    return [`@${arg1}`, '0;JMP'];
  }

  // if-goto 명령어 → pop한 값이 true면 점프
  if (cmd === 'if-goto') {
    return [
      '@SP',
      'AM=M-1',
      'D=M',
      `@${arg1}`,
      'D;JNE',              // D ≠ 0 → jump
    ];
  }

  // function 선언
  if (cmd === 'function') {
    const init = [];
    for (let i = 0; i < Number(arg2); i++) {
      init.push(
        '@0', 'D=A', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1',
      ); // 지역 변수 0으로 초기화
    }
    return [`(${arg1})`, ...init];
  }

  // 함수 호출
  if (cmd === 'call') {
    const returnLabel = `RETURN_${arg1.replace(/\./g, '_')}_${labelCounter++}`;
    return [
      `@${returnLabel}`, 'D=A', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1', // return address push
      '@LCL', 'D=M', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1', // 저장
      '@ARG', 'D=M', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1',
      '@THIS', 'D=M', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1',
      '@THAT', 'D=M', '@SP', 'A=M', 'M=D', '@SP', 'M=M+1',
      '@SP', 'D=M', `@${Number(arg2) + 5}`, 'D=D-A', '@ARG', 'M=D', // ARG 재설정
      '@SP', 'D=M', '@LCL', 'M=D', // LCL 재설정
      `@${arg1}`, '0;JMP', `(${returnLabel})`, // jump
    ];
  }

  // 함수 반환 처리
  if (cmd === 'return') {
    return [
      '@LCL', 'D=M', '@R13', 'M=D', // FRAME = LCL
      '@5', 'A=D-A', 'D=M', '@R14', 'M=D', // RET = *(FRAME-5)
      '@SP', 'AM=M-1', 'D=M', '@ARG', 'A=M', 'M=D', // *ARG = pop()
      '@ARG', 'D=M+1', '@SP', 'M=D', // SP = ARG+1
      '@R13', 'AM=M-1', 'D=M', '@THAT', 'M=D',
      '@R13', 'AM=M-1', 'D=M', '@THIS', 'M=D',
      '@R13', 'AM=M-1', 'D=M', '@ARG', 'M=D',
      '@R13', 'AM=M-1', 'D=M', '@LCL', 'M=D',
      '@R14', 'A=M', '0;JMP', // return
    ];
  }

  throw new Error(`Unsupported command: ${line}`); // 지원하지 않는 명령어 처리
}

function translateVMFile(vmCode) {
  const lines = vmCode
    .split('\n')
    .map(line => line.split('//')[0].trim()) // 주석 제거
    .filter(Boolean); // 공백 제거

  const asmLines = [];

  for (const line of lines) {
    const asm = translateLine(line); // 각 줄 번역
    asmLines.push(`// ${line}`, ...asm); // 주석과 함께 저장
  }

  return asmLines.join('\n'); // 문자열로 변환하여 리턴
}

const inputPath = process.argv[2]; // 입력 VM 파일 경로
const outputPath = inputPath.replace(/\.vm$/, '.asm'); // 출력 asm 파일 경로
const vmCode = fs.readFileSync(inputPath, 'utf-8'); // VM 파일 읽기
const asmCode = translateVMFile(vmCode); // 번역 실행
fs.writeFileSync(outputPath, asmCode); // 결과 파일로 저장

console.log(`✅ Translated: ${outputPath}`); // 완료 메시지 출력
