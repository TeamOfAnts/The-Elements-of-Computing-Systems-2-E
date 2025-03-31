// Computes R2 = max(R0, R1)
@0
D=M        // D = R0
@1
D=D-M      // D = R0 - R1
@OUTPUT_FIRST
D;JGT      // If R0 > R1, jump to OUTPUT_FIRST
@1
D=M        // D = R1
@2
M=D        // R2 = R1
@END
0;JMP
(OUTPUT_FIRST)
@0
D=M        // D = R0
@2
M=D        // R2 = R0
(END)