vx = _X / 25;
vy = _Y / 25;
t = 50 + random(50);
_xscale = t;
_yscale = t;
_alpha = 70 + random(30);
gotoAndStop(random(_totalframes - 1) + 2);
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + vy;
   vx *= 0.98;
   vy *= 0.98;
};
