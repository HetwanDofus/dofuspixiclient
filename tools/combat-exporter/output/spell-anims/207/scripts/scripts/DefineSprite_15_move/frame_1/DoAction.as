xi = this._x;
yi = this._y;
nf = this._parent.level;
c = 0;
this.onEnterFrame = function()
{
   this._parent.attachMovie("fumee","fumee" + c,c + 10);
   var _loc2_ = this._parent["fumee" + c];
   _loc2_._x = this._x;
   _loc2_._y = this._y;
   _loc2_.vx = this._x - xi + 20 * (Math.random() - 0.5);
   _loc2_.vy = this._y - yi + 20 * (Math.random() - 0.5);
   c++;
   xi = this._x;
   yi = this._y;
};
