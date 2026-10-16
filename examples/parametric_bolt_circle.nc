; Parametric bolt circle - sample for the GCode Expander
; Drills a ring of holes in depth passes, then faces a square pocket.
; Exercises: named variables, math functions, nested while loops,
; if / elseif / else, and inline [expressions] in G-code words.

; ---- Parameters ----
#<holes>       = 6        ; number of holes
#<radius>      = 25       ; bolt circle radius (mm)
#<cx>          = 50       ; circle center X
#<cy>          = 50       ; circle center Y
#<depth>       = 3        ; total hole depth (mm)
#<step>        = 1        ; depth per peck (mm)
#<safe_z>      = 5        ; clearance height
#<material>    = 2        ; 1 = wood, 2 = plastic, 3 = aluminum

; ---- Feed rate by material ----
o100 if [#<material> EQ 1]
  #<feed> = 1200
o100 elseif [#<material> EQ 2]
  #<feed> = 800
o100 else
  #<feed> = 300
o100 endif

G21 G90 G17
G0 Z#<safe_z>

; ---- Bolt circle: outer loop = holes, inner loop = pecks ----
#<i> = 0
o200 while [#<i> LT #<holes>]
  #<angle> = [360 / #<holes> * #<i>]
  G0 X[#<cx> + #<radius> * COS[#<angle>]] Y[#<cy> + #<radius> * SIN[#<angle>]]
  G0 Z1

  #<z> = 0
  o210 while [#<z> LT #<depth>]
    #<z> = [#<z> + #<step>]
    o220 if [#<z> GT #<depth>]
      #<z> = #<depth>
    o220 endif
    G1 Z[0 - #<z>] F[#<feed> / 2]
    G0 Z1
  o210 endwhile

  G0 Z#<safe_z>
  #<i> = [#<i> + 1]
o200 endwhile

; ---- Face a 20 x 20 square at the center in 2 mm stepovers ----
#<size>     = 20
#<stepover> = 2
#<x0>       = [#<cx> - #<size> / 2]
#<y>        = [#<cy> - #<size> / 2]
#<pass>     = 0

G0 X#<x0> Y#<y>
G1 Z-0.5 F[#<feed> / 2]
o300 while [#<y> LE #<cy> + #<size> / 2]
  ; zig-zag: alternate direction each pass
  o310 if [FIX[#<pass> / 2] * 2 EQ #<pass>]
    G1 X[#<x0> + #<size>] Y#<y> F#<feed>
  o310 else
    G1 X#<x0> Y#<y> F#<feed>
  o310 endif
  #<y>    = [#<y> + #<stepover>]
  #<pass> = [#<pass> + 1]
  o320 if [#<y> LE #<cy> + #<size> / 2]
    G1 Y#<y>
  o320 endif
o300 endwhile

G0 Z#<safe_z>
G0 X0 Y0 Z0
M2
