t = 50 + random(60);
_xscale = t;
_yscale = t;
vx = 6 * (-0.5 + Math.random());
vy = -3 - 5 * Math.random();
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + vy;
   vx *= 0.9;
   vy *= 0.9;
};
gotoAndPlay(random(30) + 1);
