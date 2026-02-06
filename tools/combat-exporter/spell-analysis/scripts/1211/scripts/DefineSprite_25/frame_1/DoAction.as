va = 1.67 + random(1.67);
t = 50 + random(50);
_xscale = t;
_yscale = t;
_rotation = random(360);
this.onEnterFrame = function()
{
   _alpha = _alpha - va;
};
