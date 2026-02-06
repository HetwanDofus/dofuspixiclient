t = 50 * Math.random() + 50;
stop();
_xscale = t;
_yscale = t;
vx = vx;
vt = 2;
vy *= 2;
yi = _Y - 5 + 10 * Math.random();
vr = 30 * Math.random() - 0.5;
fin = 0;
a = 0;
this.onEnterFrame = function()
{
   if(fin == 1)
   {
      _alpha = 150 - (a += 3.3);
      _xscale = t * vt * 2;
      _yscale = t * vt;
      vt -= (vt - 3) / 1.5;
   }
   _X = _X + vx;
   _Y = _Y + vy;
   _rotation = _rotation + vr;
   if(_Y > yi)
   {
      vy = 0;
      _Y = yi;
      _rotation = 0;
      vr = 0;
      pain.pain.vr = 0;
      pain.pain.i = 0.8;
      vx = 0;
      play();
      fin = 1;
   }
   vy += 0.5;
};
