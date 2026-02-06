_rotation = random(360);
t = 20 + 60 * Math.random();
_xscale = t;
_yscale = t;
_X = 20 * (Math.random() - 0.5);
_Y = 20 * (Math.random() - 0.5);
gotoAndPlay(random(15) + 1);
vr = random(10);
this.onEnterFrame = function()
{
   _rotation = _rotation + (vr *= 0.9);
};
