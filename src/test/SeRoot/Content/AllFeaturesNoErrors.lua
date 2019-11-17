local a
local b0, b1, b2, b3, b4, b5, b6 = a, nil, true, 123.44, "local", false, -1

function globalFunc0(p0, p1, p2)
  local t = {p0, p1, p2, member0 = p0 + p1, 
    member1 = p0*p1, ['member two'] = p2 - p2 + p0,
  }
  return t
end

local function localFunc0(param0, param1, ...)
  local t = globalFunc0(param0, param1, -1e-3);
  print(t);
  if not t then
    print('not t')
  elseif t or #t > 22 or not table ~= nil then
    print('t');
    print('a');
    print(globalFunc0(11, 1, -122));
    return
  elseif param0 and not param1 == nil or param0 < -1e22 or not (param0 > 22)
      or param1 > 0 or (param1 and param0 or not (t ~= nil and param0 <= 22 and param1 >= param2)) then
    do
      while true do
        local loc = -11e-22
        param0 = 214;
        if (param0) and param1 or t then
          print(param0 + param1)
          globalVar0 = param1 - param0;
          globalVar0 = globalVar0 + globalVar0
          globalVar0 = globalVar0*2 - param1
          break;
        end
        print(param0 + loc)
      end
    end
  else
    return -1
  end
  return '22'
end

local localFunc1 = function(func, ...)
  func(...)
end

--[[ multi
line
comment ]]
localFunc1(function()
  print("a")
end)

--[[ One line multiline comment]]
function globals.member0.memberFunc0()
  print(globals.member, 'hello', [[
    what
    is
    wrong
    with
    everyone
  ]])
end

local localFunc2 = function()
  return function(a, b, c) return (a + b)*c/(a - b)*2^2 end
end

localFunc2()(1, 2, 3)

do
  local i = 0
  local localTable0 = {}
  repeat
    i = i + 1
    print(i)
    table.insert(localTable0, (i + 1)*22 - 1e+24*0.00001*i)
    for it=-1, 22 + i, 3 do
      if it > 5 then
        print(it)
      end
    end
    for i, v in ipairs(localTable0) do
      if i > v then
        if v > -231 then
          print("There you go");
          print("v=", v)
        end
      else
      end
    end
  until i > 22 and not i < -1;
end