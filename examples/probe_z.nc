(Z probe with a touch plate on top of the stock)
(Jog the bit over the plate, 10-20 mm above it, then run this file.)
(Sets Z0 of the active work coordinate system to the top of the stock.)

#<plate> = 12.7      (touch plate thickness, mm)
#<travel> = 40       (how far down to search)
#<fast> = 200        (search feed, mm/min)
#<slow> = 25         (measuring feed, mm/min)
#<backoff> = 2       (lift between the two probes)
#<clearance> = 10    (height above the stock when done)

G21 G91                            (mm, relative moves)
G38.2 Z[-#<travel>] F#<fast>       (search down to the plate)
G0 Z#<backoff>                     (back off)
G38.2 Z[-#<backoff> - 1] F#<slow>  (slow second touch for accuracy)

G90
G10 L20 P0 Z#<plate>               (the bit is now one plate thickness above the stock)
G0 Z[#<plate> + #<clearance>]      (lift clear of the plate)
M0 (Remove the touch plate)
