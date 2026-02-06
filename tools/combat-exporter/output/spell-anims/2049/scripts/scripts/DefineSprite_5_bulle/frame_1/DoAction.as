rx = 0.7 + 0.15 * Math.random();
ry = 0.8 + 0.15 * Math.random();
vx = 20 + random(25);
vy = -15 + random(30);
_alpha = random(50) + 50;
this.onEnterFrame = function()
{
   _X = _X + (vx *= rx);
   _Y = _Y + (vy *= ry);
};
