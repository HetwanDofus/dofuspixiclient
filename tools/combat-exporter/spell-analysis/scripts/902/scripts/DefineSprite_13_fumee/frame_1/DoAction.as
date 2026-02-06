t = 50 * Math.random() + 50;
_xscale = t;
_yscale = t;
_rotation = random(360);
vx /= 1 + 3 * Math.random();
vy /= 3;
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + vy;
   vx /= 3;
   vy /= 3;
};
