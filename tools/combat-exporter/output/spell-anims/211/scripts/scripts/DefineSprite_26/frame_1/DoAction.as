_X = 30 * (-0.5 + Math.random());
_Y = 30 * (-0.5 + Math.random());
ta = 150 + random(50);
t = 100 + 400 * Math.random();
va = 1.3 + 1.3 * Math.random();
this.onEnterFrame = function()
{
   ta -= (ta - t) / 7;
   _xscale = ta;
   _yscale = ta;
   _alpha = _alpha - va;
};
