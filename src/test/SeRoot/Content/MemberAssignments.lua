local t = {u = 1, v = "vee", subTable = {a = 1, b = 2, subSubTable = {cc = "cc"}}}
local sampleObject = tstGetDerivedSampleObject()
t.a = {}
t.a.x = 1
t.bee = tstGetSampleObject()
t.cee--[[:CDerivedSampleClass]] = tstGetSampleObject()
t.a.y = "why"
t.a.zee = t.cee:GetBaseClass()
t.a.wee = t.cee
function t.func()
end
t.a.u = sampleObject
t.a.tbl = {u = 1, v = "vee", subTable = {a = 1, b = 2, subSubTable = {cc = "cc"}}}