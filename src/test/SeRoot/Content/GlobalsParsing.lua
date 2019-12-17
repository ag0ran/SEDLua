local locA
local locB = {"Hello", "World"}

globals.a = "a"
globals.b.c = "b.c"

newGlobal = {}
newGlobal.a = "a"
newGlobal.b.c = "b.c"

function newGlobal.func(p0, p1, p2)
  newGlobal.d = {}
  local locA = 2
  local locB = p0 + p1 + p2
  return locB + locA
end
