_parent.i = -3.1415;
c = 0;
this.onEnterFrame = function()
{
   if(c < 40)
   {
      this.attachMovie("tige","tige" + c,c);
      c += 2;
      _parent.i += 0.3;
   }
};
