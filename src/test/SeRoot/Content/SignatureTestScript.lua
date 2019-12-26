-- derivedSampleObject : CDerivedSampleClass
local derivedSampleObject = tstGetDerivedSampleObject()
derivedSampleObject:AcceptLotsOfParams(1, "2", nil, derivedSampleObject, mthVector3f(1, 2, 3))


tstGetSampleObject(idSampleObject)
tstGetSampleObject(derivedSampleObject:GetName())

derivedSampleObject:AcceptLotsOfParams(1, )

-- leaving open the function call and testing that statement below is not considered to be a part of this call
derivedSampleObject:AcceptLotsOfParams(1, "2"
tstGetSampleObject("Hello") 

derivedSampleObject:AcceptLotsOfParams(2, {"what", "who", "where", whatever={1, 2, 3 }}, )

RunAsync(
  function()
  end
  On(Delay(1)),
  function()
    derivedSampleObject:AcceptLotsOfParams(2, {"what", "who", "where", whatever={1, 2, 3 }}, )
    derivedSampleObject:AcceptLotsOfParams(0, , 2, , , 5, )
    derivedSampleObject:AcceptLotsOfParams(    , , 2, , , 5, );
  end,

)

-- Yet another local function
local function LocFunc(a, b)
  return a + b
end

LocFunc()
LocFunc(1, )