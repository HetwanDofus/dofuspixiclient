v = 10 + random(15);
_xscale = random(50) + 50;
_yscale = random(50) + 50;
this.onEnterFrame = function()
{
   _rotation = _rotation + v;
};
