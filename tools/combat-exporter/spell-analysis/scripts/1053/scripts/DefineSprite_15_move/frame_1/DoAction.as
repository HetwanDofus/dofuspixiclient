c = 1;
this.onEnterFrame = function()
{
   t = 1;
   while(t <= 2)
   {
      _parent.attachMovie("spire","spire" + c,c);
      eval("_parent.spire" + c)._x = _X;
      eval("_parent.spire" + c)._y = _Y;
      eval("_parent.spire" + c)._rotation = _rotation;
      eval("_parent.spire" + c).c = c;
      c++;
      t++;
   }
};
play();
