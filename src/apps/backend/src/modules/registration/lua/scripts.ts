/**
 * Lua scripts inline để chắc chắn chúng được bundle vào dist (tsc không copy .lua files).
 * Source ý nghĩa: xem `allocate-seat.lua`, `release-seat.lua` cùng thư mục.
 */

export const ALLOCATE_SEAT_LUA = `
local exists = redis.call('EXISTS', KEYS[1])
if exists == 0 then
  redis.call('SET', KEYS[1], tonumber(ARGV[3]))
end

local existingHold = redis.call('GET', KEYS[2])
if existingHold then
  return {0, 'already_holding', existingHold}
end

local left = tonumber(redis.call('GET', KEYS[1]))
if left == nil or left <= 0 then
  return {0, 'sold_out'}
end

redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))

return {1, left - 1}
`;

export const RELEASE_SEAT_LUA = `
local hold = redis.call('GET', KEYS[2])
if not hold then
  return {0, 'no_hold'}
end

if ARGV[1] ~= '' and hold ~= ARGV[1] then
  return {0, 'mismatch'}
end

redis.call('DEL', KEYS[2])

local exists = redis.call('EXISTS', KEYS[1])
if exists == 1 then
  local left = redis.call('INCR', KEYS[1])
  return {1, left}
end

return {1, -1}
`;
