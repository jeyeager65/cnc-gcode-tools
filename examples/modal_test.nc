; Test file for modal G-code commands
; Lines without G commands should use previous motion mode

G90 G21 ; Absolute mode, millimeters
G0 Z5 ; Rapid move up
G0 X0 Y0 ; Rapid to origin

; Test modal G0 (rapid moves without repeating G0)
G0 X10 Y0
X20 Y0
X30 Y0
X30 Y10

; Test modal G1 (linear moves without repeating G1)
G1 Z0 F1000
X20 Y10
X10 Y10
X0 Y10
X0 Y0

; Test with mixed parameters
G1 X10
Y20
Z5
X20 Y30 Z10

; Return home
G0 Z5
X0 Y0
