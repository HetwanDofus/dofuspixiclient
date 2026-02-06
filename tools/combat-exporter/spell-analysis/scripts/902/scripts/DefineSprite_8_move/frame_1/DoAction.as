xi = this._x;
yi = this._y;
nf = 1;
c = 0;
this.onEnterFrame = function()
{
   var _loc2_ = 0;
   var _loc3_;
   while(_loc2_ < nf)
   {
      this._parent.attachMovie("fumee","fumee" + c,c + 10);
      _loc3_ = this._parent["fumee" + c];
      _loc3_._x = this._x + 15 * (Math.random() - 0.5);
      _loc3_._y = this._y + 15 * (Math.random() - 0.5);
      c++;
      _loc2_ = _loc2_ + 1;
   }
   xi = this._x;
   yi = this._y;
};
