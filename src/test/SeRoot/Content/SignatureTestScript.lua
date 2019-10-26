-- derivedSampleObject : CDerivedSampleClass
local derivedSampleObject = tstGetDerivedSampleObject()
derivedSampleObject:AcceptLotsOfParams(1, "2", nil, derivedSampleObject, mthVector3f(1, 2, 3))


tstGetSampleObject(idSampleObject)
tstGetSampleObject(derivedSampleObject:GetName())

derivedSampleObject:AcceptLotsOfParams(1, )

-- leaving open the function call and testing that statement below is not considered to be a part of this call
derivedSampleObject:AcceptLotsOfParams(1, "2"
tstGetSampleObject("Hello") 