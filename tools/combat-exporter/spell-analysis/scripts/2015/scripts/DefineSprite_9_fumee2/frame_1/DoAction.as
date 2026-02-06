t = 20 * Math.random() + 80;
gotoAndPlay(random(45));
_xscale = t;
_yscale = t;
vx = vx;
vy *= 2;
yi = _Y - 15 + 30 * Math.random();
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + vy;
   if(_Y > yi)
   {
      vy = (- vy) / 2;
      vx *= 0.7;
      _Y = yi;
   }
   vy += 1.5;
};
