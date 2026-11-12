-- 서버(실제 계산)와 클라이언트(표시용)가 같은 공식을 쓰도록 shared에 둔다.
local Config = require(script.Parent.Config)

local Formulas = {}

local SUFFIXES = { "", "K", "M", "B", "T", "Qa" }

function Formulas.upgradeCost(id: string, level: number): number
	local def = Config.Upgrades[id]
	return math.floor(def.BaseCost * def.CostGrowth ^ level)
end

function Formulas.multiplier(levels, hasGamepass: boolean): number
	local m = 1 + Config.Upgrades.Multiplier.PerLevel * (levels.Multiplier or 0)
	if hasGamepass then
		m *= 2
	end
	return m
end

function Formulas.clickValue(levels, hasGamepass: boolean): number
	local base = 1 + Config.Upgrades.ClickPower.PerLevel * (levels.ClickPower or 0)
	return math.floor(base * Formulas.multiplier(levels, hasGamepass))
end

function Formulas.perSecond(levels, hasGamepass: boolean): number
	local base = Config.Upgrades.AutoIncome.PerLevel * (levels.AutoIncome or 0)
	return math.floor(base * Formulas.multiplier(levels, hasGamepass))
end

function Formulas.format(n: number): string
	n = math.floor(n)
	local i = 1
	while n >= 1000 and i < #SUFFIXES do
		n /= 1000
		i += 1
	end
	if i == 1 then
		return tostring(n)
	end
	return string.format("%.2f%s", n, SUFFIXES[i])
end

return Formulas
