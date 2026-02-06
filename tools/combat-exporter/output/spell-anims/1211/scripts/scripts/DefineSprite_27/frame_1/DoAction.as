t = 50 + random(50);
_xscale = _xscale * (t / 100);
_yscale = _yscale * (t / 100);
h = -20 + random(40);
g = 0.5;
_alpha = 1.67;
vy = 0;
hit = 0;
poids.gotoAndPlay(random(24) + 1);
this.onEnterFrame = function()
{
   if(hit != 1)
   {
      _alpha = _alpha + 5;
   }
   else
   {
      _alpha = _alpha - 3.34;
   }
   _Y = _Y + vy;
   if(_Y > h)
   {
      hit = 1;
      fumee.play();
      poids.stop();
      _Y = h;
      vy = (- vy) * 0.3;
   }
   vy += g;
};
