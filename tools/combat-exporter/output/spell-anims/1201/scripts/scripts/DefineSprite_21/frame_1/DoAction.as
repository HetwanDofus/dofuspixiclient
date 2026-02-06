_X = 20 * (-0.5 + Math.random());
vy = 1 + 1.67 * Math.random();
va = 1 + random(1.67);
_alpha = 0;
va2 = 20;
_rotation = - _parent._parent.angle + 90;
this.onEnterFrame = function()
{
   _alpha = _alpha - va;
   _alpha = _alpha + va2;
   vy *= 0.97;
   va2 *= 0.8;
   _Y = _Y - vy;
};
