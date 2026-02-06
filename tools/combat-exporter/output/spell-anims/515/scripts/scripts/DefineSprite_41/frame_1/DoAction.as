vr = 5 * Math.random();
va = 1 + 2.5 * Math.random();
this.onEnterFrame = function()
{
   _alpha = _alpha - va;
   _rotation = _rotation + (vr *= 0.9);
};
