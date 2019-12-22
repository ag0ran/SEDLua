local function acceptDerivedSampleClass(param0 --[[:CDerivedSampleClass]], param1--[[:CSampleClass]]) 
  local subObject = param0:GetSubobject("Lala", 1)
  local name = subObject:GetName()
  print(name)
end