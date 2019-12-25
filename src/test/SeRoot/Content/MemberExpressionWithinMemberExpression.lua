local obj = tstGetSampleObject()

globals.Cutscene("whatever", function()
  obj:GetName()
  tstGetSampleObject()
end)