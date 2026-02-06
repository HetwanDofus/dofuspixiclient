_rotation = random(360);
_Y = -90;
g = 0.6;
v = 0;
h = _parent.h;
_parent.h += 0.5;
amp = 60 - h;
dh = random(5);
_X = amp * (-0.5 + Math.random());
t = 30 + 70 * Math.random();
_xscale = t;
_yscale = t;
vx = -0.5 + Math.random();
this.onEnterFrame = function()
{
   _X = _X + vx;
   _Y = _Y + (v += g);
   if(_Y > - h)
   {
      _Y = - h;
      h -= random(Math.round(dh));
      dh *= 0.5 + 0.5 * Math.random();
      vx *= 0.23;
      stop();
      v = (- v) / (3 + random(7));
   }
};
