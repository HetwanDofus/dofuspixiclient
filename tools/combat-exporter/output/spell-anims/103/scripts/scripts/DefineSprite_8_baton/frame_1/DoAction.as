v = 1.6 * (-0.5 + Math.random());
vy = 3 * (-0.5 + Math.random());
f = _root._currentframe;
t = 50 + 40 * (-0.5 + Math.random());
_yscale = t + 5;
_xscale = t + 5;
this.onEnterFrame = function()
{
   _X = _X + v;
   _Y = _Y + vy;
   v *= 0.95;
   vy *= 0.95;
};
