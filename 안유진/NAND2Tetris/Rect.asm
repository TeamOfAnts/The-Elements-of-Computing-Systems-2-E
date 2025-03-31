// Draws a 16-pixel-wide rectangle of height R0
@0
D=M            // D = R0 (height)
@HEIGHT
M=D            // HEIGHT = R0
@0
D=A
@i
M=D            // i = 0

(LOOP)
@i
D=M
@HEIGHT
D=D-M
@END
D;JEQ          // if i == HEIGHT, end

// calculate address = SCREEN + i * 32
@i
D=M
@32
D=D*A
@SCREEN
D=A+D
@addr
M=D

// write 16 bits of 1s to that address (fill 16 pixels)
@addr
A=M
M=-1

// i++
@i
M=M+1
@LOOP
0;JMP

(END)