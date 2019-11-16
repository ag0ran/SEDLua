local a = 123fg12
local good_a = 123
local b = 12e
local good_b = 12e12
local c = 0x
local good_c = 0xfa12af
local d = 122.22.123.67
local good_d = 122.22
local e = 122._22
local good_e = 122_000.22_22
local f = 122_000_
local good_f = 122_000_000
what = "Good string"
-- hello comment
--[[ hello multiline comment
in multiple lines]]
what = [[good multiline

string]]
what = [=[
  good multiline string
]=]
what = "Bad string
