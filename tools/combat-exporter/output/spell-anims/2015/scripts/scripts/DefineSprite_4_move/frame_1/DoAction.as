xi = this._x;
yi = this._y;
nf = 0.33;
c = 0;
this.onEnterFrame = function()
{
   var _loc3_ = 0;
   var _loc2_;
   while(_loc3_ < nf)
   {
      this._parent.attachMovie("fumee","fumee" + c,c + 10);
      _loc2_ = this._parent["fumee" + c];
      _loc2_._x = this._x;
      _loc2_._y = this._y;
      _loc2_.vx = this._x - xi + 6.67 * (Math.random() - 0.5);
      _loc2_.vy = this._y - yi + 6.67 * (Math.random() - 0.5);
      c++;
      _loc3_ = _loc3_ + 1;
   }
   xi = this._x;
   yi = this._y;
};
